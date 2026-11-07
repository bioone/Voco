import torch
import soundfile as sf
import os
import csv
import time
import sys
import io
import numpy as np

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")


def resample_to_16k(audio, orig_sr):
    """简易线性插值重采样到 16000Hz"""
    if orig_sr == 16000:
        return audio
    target_sr = 16000
    old_len = len(audio)
    new_len = int(old_len * target_sr / orig_sr)
    indices = np.linspace(0, old_len - 1, new_len)
    return np.interp(indices, np.arange(old_len), audio).astype(np.float32)

MODEL_PATH = r"E:\electron\qwenASR\model\GLM-ASR-Nano-2512"
AUDIO_FOLDER = r"E:\electron\qwenASR\voice_design\知识科普"
CSV_PATH = r"E:\electron\qwenASR\voice_design\voice_library.csv"
os.environ["PATH"] += r";C:\Program Files (x86)\sox-14-4-2"

print("=" * 60)
print("GLM-ASR-Nano-2512 语音识别测试")
print("=" * 60)
print(f"GPU: {torch.cuda.get_device_name(0)}")
print()

# 获取测试用的音频文件列表
audio_files = sorted([
    f for f in os.listdir(AUDIO_FOLDER)
    if f.endswith(".wav") and not f.endswith("_prompt.txt") and not f.endswith("_text.txt")
])
print(f"知识科普目录: {len(audio_files)} 个音频文件")
print()

print("正在加载 GLM-ASR 模型...")
t0 = time.time()
from transformers import AutoModelForSeq2SeqLM, AutoProcessor

try:
    processor = AutoProcessor.from_pretrained(MODEL_PATH, trust_remote_code=True)
    model = AutoModelForSeq2SeqLM.from_pretrained(
        MODEL_PATH, dtype="auto", device_map="auto", trust_remote_code=True
    )
    print(f"模型加载完成! 耗时: {time.time() - t0:.1f} 秒")
    print(f"模型设备: {model.device}")
    print()
except Exception as e:
    print(f"加载失败: {e}")
    print("可能需要升级 transformers 到 5.x 版本")
    sys.exit(1)

# ─── 读取原始文本 (从 text_file 对应文件读) ───
original_texts = {}
base = os.path.dirname(CSV_PATH)
with open(CSV_PATH, "r", encoding="utf-8-sig") as f:
    for row in csv.DictReader(f):
        if row["category"] == "知识科普":
            txt_path = os.path.join(base, row["text_file"])
            if os.path.exists(txt_path):
                with open(txt_path, "r", encoding="utf-8") as tf:
                    original_texts[row["id"]] = tf.read().strip()
            else:
                original_texts[row["id"]] = ""

results = []
total_time = 0

for i, fname in enumerate(audio_files):
    audio_path = os.path.join(AUDIO_FOLDER, fname)
    voice_id = fname.replace(".wav", "")

    # 读取音频
    audio_array, sr = sf.read(audio_path)
    audio_len = len(audio_array) / sr

    # 转成单声道
    if len(audio_array.shape) > 1:
        audio_array = audio_array.mean(axis=1)

    # 重采样到 16kHz (GLM-ASR 要求)
    if sr != 16000:
        audio_array = resample_to_16k(audio_array, sr)
        sr = 16000

    print(f"[{i+1}/{len(audio_files)}] {voice_id} ({audio_len:.1f}s) ...", end=" ")

    t1 = time.time()
    try:
        inputs = processor.apply_transcription_request(audio_array)
        inputs = inputs.to(model.device, dtype=model.dtype)

        outputs = model.generate(
            **inputs, do_sample=False, max_new_tokens=500
        )

        decoded = processor.batch_decode(
            outputs[:, inputs.input_ids.shape[1]:], skip_special_tokens=True
        )
        recognized_text = decoded[0].strip()
        elapsed = time.time() - t1
        total_time += elapsed

        # 比较
        original = original_texts.get(voice_id, "")
        match = "✓" if original and recognized_text and original[:10] in recognized_text or recognized_text[:10] in original else "?"
        if match == "?":
            # 更宽松的比较
            common = len(set(original) & set(recognized_text))
            total = max(len(set(original)), 1)
            ratio = common / total
            match = "~" if ratio > 0.3 else "✗"

        print(f"{elapsed:.1f}s [{match}]")
        print(f"    原始: {original[:60]}...")
        print(f"    识别: {recognized_text[:60]}...")

        results.append({
            "id": voice_id,
            "audio": fname,
            "duration": audio_len,
            "original": original,
            "recognized": recognized_text,
            "match": match,
            "time": elapsed,
        })
    except Exception as e:
        print(f"失败: {e}")
        results.append({
            "id": voice_id,
            "audio": fname,
            "duration": audio_len,
            "original": original_texts.get(voice_id, ""),
            "recognized": f"[ERROR] {e}",
            "match": "E",
            "time": time.time() - t1,
        })

# ─── 统计结果 ───
print()
print("=" * 60)
print("识别结果统计")
print("=" * 60)

good = sum(1 for r in results if r["match"] == "✓")
partial = sum(1 for r in results if r["match"] == "~")
bad = sum(1 for r in results if r["match"] == "✗")
errors = sum(1 for r in results if r["match"] == "E")

total = len(results)
print(f"  正确(✓): {good}/{total} ({good/total*100:.1f}%)")
print(f"  部分(~): {partial}/{total} ({partial/total*100:.1f}%)")
print(f"  错误(✗): {bad}/{total} ({bad/total*100:.1f}%)")
print(f"  异常(E): {errors}/{total} ({errors/total*100:.1f}%)")
print(f"  总耗时: {total_time:.1f}s")
print()

# 打印详情
print("=" * 60)
print("详细结果")
print("=" * 60)
for r in results:
    status = {"✓": "正确", "~": "部分", "✗": "错误", "E": "异常"}[r["match"]]
    print(f"  [{status}] {r['id']}")
    print(f"    原始: {r['original'][:80]}")
    print(f"    识别: {r['recognized'][:80]}")
    print()
