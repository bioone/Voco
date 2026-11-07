"""使用 MonkeyOCRv2-B-Parsing 对 PDF 进行 OCR 解析。

用法:
    python run_ocr.py                       # 解析默认 PDF cap4二型的结合2023.pdf
    python run_ocr.py --pdf <path>          # 指定 PDF
    python run_ocr.py --pdf-dir <dir>       # 解析目录下所有 PDF
    python run_ocr.py --output <dir>        # 指定输出目录

输出:
    <output>/<pdf-name>/
        ├── page_0001.md ~ page_NNNN.md     逐页 Markdown
        ├── <pdf-name>.md                   合并 Markdown
        └── meta.json                       元数据(页数/耗时/状态)

实现说明:
    使用 transformers + 官方 prompt 模板(参考 parsing/core_runner.py 的 ALL_PROMPT)。
    由于模型自带的 prepare_inputs_for_generation 调用 super() 时没传 cache_position,
    导致 transformers 4.57.6 的 generate 崩溃。这里通过 monkey-patch 替换
    prepare_inputs_for_generation, 正确传递 cache_position, 并只在第一次迭代时
    设置 pixel_values。
"""

from __future__ import annotations

import argparse
import io
import json
import sys
import time
import types
from pathlib import Path
from typing import Any

if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", line_buffering=True)

PROJECT_ROOT = Path(__file__).resolve().parent
DEFAULT_MODEL_PATH = PROJECT_ROOT / "model" / "MonkeyOCRv2-B-Parsing"
DEFAULT_PDF_PATH = PROJECT_ROOT / "cap4二型的结合2023.pdf"
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "ocr"

# 官方 prompt: 参考 parsing/core_runner.py 的 ALL_PROMPT["Text"]
OCR_PROMPT = "Please output the text content from the image."


def check_cuda() -> str:
    import torch
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA 不可用，MonkeyOCRv2 需要 GPU 才能高效推理。")
    return torch.cuda.get_device_name(0)


def load_model(model_path: Path):
    import torch
    from transformers import AutoModelForCausalLM, AutoProcessor

    if not model_path.exists():
        raise FileNotFoundError(f"模型目录不存在: {model_path}")

    print(f"正在加载模型: {model_path}")
    t0 = time.time()

    processor = AutoProcessor.from_pretrained(str(model_path), trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(
        str(model_path),
        dtype=torch.bfloat16,
        device_map="auto",
        trust_remote_code=True,
    )

    print(f"模型加载完成，耗时 {time.time() - t0:.1f}s")
    print(f"设备: {model.device}")
    return model, processor


def patch_prepare_inputs_for_generation(model: Any) -> None:
    """Monkey-patch prepare_inputs_for_generation 以修复 transformers 4.57.6 兼容性问题。

    问题: 模型自带的 prepare_inputs_for_generation 调用 super() 时没传 cache_position,
    导致 generate 内部 cache_position=None, 触发 'NoneType' object is not subscriptable。

    修复: 直接调用 Qwen3ForCausalLM.prepare_inputs_for_generation, 正确传递
    cache_position, 并只在第一次迭代(past_key_values 为空)时设置 pixel_values。
    """
    from transformers.models.qwen3.modeling_qwen3 import Qwen3ForCausalLM

    def prepare_inputs_for_generation(
        self,
        input_ids,
        past_key_values=None,
        inputs_embeds=None,
        pixel_values=None,
        attention_mask=None,
        cache_position=None,
        num_logits_to_keep=None,
        **kwargs,
    ):
        model_inputs = Qwen3ForCausalLM.prepare_inputs_for_generation(
            self,
            input_ids,
            past_key_values=past_key_values,
            inputs_embeds=inputs_embeds,
            attention_mask=attention_mask,
            cache_position=cache_position,
            num_logits_to_keep=num_logits_to_keep,
            **kwargs,
        )
        is_first = past_key_values is None or (
            hasattr(past_key_values, "get_seq_length") and past_key_values.get_seq_length() == 0
        )
        if is_first and pixel_values is not None:
            model_inputs["pixel_values"] = pixel_values
        return model_inputs

    model.prepare_inputs_for_generation = types.MethodType(
        prepare_inputs_for_generation, model
    )


def render_page_image(page: Any, zoom: float = 2.0):
    from PIL import Image
    import fitz

    mat = fitz.Matrix(zoom, zoom)
    pix = page.get_pixmap(matrix=mat)
    img_bytes = pix.tobytes("png")
    return Image.open(io.BytesIO(img_bytes)).convert("RGB")


def ocr_page(
    model: Any,
    processor: Any,
    pil_image,
    max_new_tokens: int = 4096,
) -> str:
    """对单页图片执行 OCR。

    使用官方 prompt 模板(参考 parsing/core_runner.py 的 ALL_PROMPT)。
    generate 参数: do_sample=False (贪婪解码) + repetition_penalty 抑制重复。
    """
    import torch

    messages = [
        {
            "role": "user",
            "content": [
                {"type": "image", "image": pil_image},
                {"type": "text", "text": OCR_PROMPT},
            ],
        }
    ]

    text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = processor(
        text=[text],
        images=[pil_image],
        padding=True,
        return_tensors="pt",
    )

    device = model.device
    # 过滤 mm_token_type_ids(generate 不接受), 把 tensor 搬到设备
    model_kwargs: dict[str, Any] = {}
    for k, v in inputs.items():
        if k == "mm_token_type_ids":
            continue
        if isinstance(v, torch.Tensor):
            model_kwargs[k] = v.to(device)

    with torch.no_grad():
        outputs = model.generate(
            **model_kwargs,
            do_sample=False,
            max_new_tokens=max_new_tokens,
            repetition_penalty=1.1,
        )

    input_len = model_kwargs["input_ids"].shape[1]
    generated_ids = outputs[:, input_len:]
    page_md = processor.batch_decode(generated_ids, skip_special_tokens=True)[0].strip()
    return page_md


def parse_pdf(
    model: Any,
    processor: Any,
    pdf_path: Path,
    output_dir: Path,
    zoom: float = 2.0,
    max_new_tokens: int = 4096,
) -> dict[str, Any]:
    import fitz

    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF 不存在: {pdf_path}")

    pdf_name = pdf_path.stem
    pdf_output_dir = output_dir / pdf_name
    pdf_output_dir.mkdir(parents=True, exist_ok=True)

    doc = fitz.open(str(pdf_path))
    num_pages = len(doc)
    print(f"\n{'=' * 60}")
    print(f"开始解析: {pdf_path.name}")
    print(f"总页数: {num_pages}")
    print(f"输出目录: {pdf_output_dir}")
    print(f"{'=' * 60}")

    page_mds: list[str] = []
    page_meta: list[dict[str, Any]] = []
    total_time = 0.0

    for page_num in range(num_pages):
        print(f"[{page_num + 1}/{num_pages}] 解析第 {page_num + 1} 页...", end=" ")
        t1 = time.time()

        try:
            page = doc[page_num]
            pil_image = render_page_image(page, zoom=zoom)
            page_md = ocr_page(
                model, processor, pil_image,
                max_new_tokens=max_new_tokens,
            )
            status = "ok"
            err = None
        except Exception as e:
            import traceback
            traceback.print_exc()
            page_md = f"<!-- 第 {page_num + 1} 页解析失败: {e} -->"
            status = "error"
            err = str(e)

        elapsed = time.time() - t1
        total_time += elapsed
        page_mds.append(page_md)
        page_meta.append({
            "page": page_num + 1,
            "status": status,
            "error": err,
            "chars": len(page_md),
            "elapsed_sec": round(elapsed, 2),
        })

        page_path = pdf_output_dir / f"page_{page_num + 1:04d}.md"
        page_path.write_text(
            f"<!-- Page {page_num + 1}/{num_pages} -->\n\n{page_md}",
            encoding="utf-8",
        )
        print(f"{elapsed:.1f}s ({len(page_md)} chars)")

    # 合并所有页面
    full_md_path = pdf_output_dir / f"{pdf_name}.md"
    with open(full_md_path, "w", encoding="utf-8") as f:
        f.write(f"# {pdf_name}\n\n")
        for i, md in enumerate(page_mds):
            if i > 0:
                f.write("\n\n---\n\n<!-- Page Break -->\n\n")
            f.write(md)

    meta = {
        "pdf": str(pdf_path),
        "pdf_name": pdf_name,
        "num_pages": num_pages,
        "ok_pages": sum(1 for p in page_meta if p["status"] == "ok"),
        "error_pages": sum(1 for p in page_meta if p["status"] == "error"),
        "total_time_sec": round(total_time, 2),
        "avg_time_per_page_sec": round(total_time / num_pages, 2) if num_pages else 0,
        "output_dir": str(pdf_output_dir),
        "full_md": str(full_md_path),
        "pages": page_meta,
    }
    meta_path = pdf_output_dir / "meta.json"
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    doc.close()

    print(f"\n解析完成: {pdf_name}")
    print(f"  成功 {meta['ok_pages']}/{num_pages} 页，失败 {meta['error_pages']} 页")
    print(f"  总耗时 {total_time:.1f}s，平均 {meta['avg_time_per_page_sec']}s/页")
    print(f"  合并 Markdown: {full_md_path}")
    return meta


def main():
    parser = argparse.ArgumentParser(description="用 MonkeyOCRv2-B-Parsing 对 PDF 做 OCR")
    parser.add_argument("--pdf", type=Path, default=DEFAULT_PDF_PATH, help="PDF 文件路径")
    parser.add_argument("--pdf-dir", type=Path, help="批量解析目录下所有 PDF")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_DIR, help="输出根目录")
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL_PATH, help="模型目录")
    parser.add_argument("--zoom", type=float, default=2.0, help="PDF 渲染缩放倍率")
    parser.add_argument("--max-new-tokens", type=int, default=4096, help="每页最大生成 token 数")
    args = parser.parse_args()

    device_name = check_cuda()
    print(f"GPU: {device_name}")

    model, processor = load_model(args.model)

    # Monkey-patch 修复 transformers 4.57.6 的 generate 兼容性问题
    patch_prepare_inputs_for_generation(model)

    args.output.mkdir(parents=True, exist_ok=True)

    if args.pdf_dir:
        pdf_files = sorted(list(args.pdf_dir.glob("*.pdf")))
        if not pdf_files:
            print(f"目录 {args.pdf_dir} 下没有 PDF 文件")
            return
        print(f"找到 {len(pdf_files)} 个 PDF 文件")
        all_meta = []
        for pdf in pdf_files:
            meta = parse_pdf(
                model, processor, pdf, args.output,
                zoom=args.zoom, max_new_tokens=args.max_new_tokens,
            )
            all_meta.append(meta)
        print(f"\n{'=' * 60}")
        print(f"批量解析完成: {len(all_meta)} 个 PDF")
        for m in all_meta:
            print(f"  {m['pdf_name']}: {m['ok_pages']}/{m['num_pages']} 页成功")
    else:
        if not args.pdf.exists():
            print(f"PDF 文件不存在: {args.pdf}")
            return
        parse_pdf(
            model, processor, args.pdf, args.output,
            zoom=args.zoom, max_new_tokens=args.max_new_tokens,
        )


if __name__ == "__main__":
    main()
