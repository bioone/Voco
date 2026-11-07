import torch
import soundfile as sf
import os
import csv
import json
import time
import sys
import io
import numpy as np

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

MODEL_PATH = r"E:\electron\qwenASR\model\GLM-ASR-Nano-2512"
INPUT_DIR = r"E:\electron\qwenASR\voice_design"
OUTPUT_DIR = r"E:\electron\qwenASR\voice_asr"
CSV_IN = os.path.join(INPUT_DIR, "voice_library.csv")
CSV_OUT = os.path.join(OUTPUT_DIR, "asr_results.csv")
JSON_OUT = os.path.join(OUTPUT_DIR, "asr_results.json")
os.environ["PATH"] += r";C:\Program Files (x86)\sox-14-4-2"


def resample_to_16k(audio, orig_sr):
    if orig_sr == 16000:
        return audio
    target_sr = 16000
    new_len = int(len(audio) * target_sr / orig_sr)
    indices = np.linspace(0, len(audio) - 1, new_len)
    return np.interp(indices, np.arange(len(audio)), audio).astype(np.float32)


print("=" * 60)
print("GLM-ASR 批量语音识别")
print(f"输入: {INPUT_DIR}")
print(f"输出: {OUTPUT_DIR}")
print("=" * 60)
print()

# ─── 读取 CSV 总览 ───
with open(CSV_IN, "r", encoding="utf-8-sig") as f:
    all_voices = list(csv.DictReader(f))
print(f"voice_design 共 {len(all_voices)} 条声音记录\n")

# ─── 加载模型 ───
print("正在加载 GLM-ASR 模型...")
t0 = time.time()
from transformers import GlmAsrForConditionalGeneration, AutoProcessor

processor = AutoProcessor.from_pretrained(MODEL_PATH, trust_remote_code=True)
model = GlmAsrForConditionalGeneration.from_pretrained(
    MODEL_PATH, dtype="auto", device_map="auto", trust_remote_code=True
)
print(f"模型加载完成! 耗时: {time.time() - t0:.1f}s")
print(f"设备: {model.device}\n")

# ─── 逐个识别 ───
os.makedirs(OUTPUT_DIR, exist_ok=True)
results = []
total_time = 0

for i, voice in enumerate(all_voices):
    voice_id = voice["id"]
    rel_audio = voice["audio_file"]
    audio_path = os.path.join(INPUT_DIR, rel_audio)
    category = voice["category"]

    # 从 text_file 读取原始文本
    original_text = ""
    txt_rel = voice.get("text_file", "")
    if txt_rel:
        txt_path = os.path.join(INPUT_DIR, txt_rel)
        if os.path.exists(txt_path):
            with open(txt_path, "r", encoding="utf-8") as f:
                original_text = f.read().strip()

    if not os.path.exists(audio_path):
        print(f"[{i+1}/{len(all_voices)}] {voice_id} - 音频不存在, 跳过")
        continue

    audio_array, sr = sf.read(audio_path)
    audio_len = len(audio_array) / sr
    if len(audio_array.shape) > 1:
        audio_array = audio_array.mean(axis=1)
    if sr != 16000:
        audio_array = resample_to_16k(audio_array, sr)

    print(f"[{i+1}/{len(all_voices)}] {voice_id} ({category}) {audio_len:.1f}s ...", end=" ")

    t1 = time.time()
    try:
        inputs = processor.apply_transcription_request(audio_array)
        inputs = inputs.to(model.device, dtype=model.dtype)
        outputs = model.generate(**inputs, do_sample=False, max_new_tokens=500)
        decoded = processor.batch_decode(outputs[:, inputs.input_ids.shape[1]:], skip_special_tokens=True)
        recognized_text = decoded[0].strip()
        elapsed = time.time() - t1
        total_time += elapsed

        # 保存结果
        out_category = os.path.join(OUTPUT_DIR, category)
        os.makedirs(out_category, exist_ok=True)
        out_audio = os.path.join(out_category, f"{voice_id}.wav")
        out_txt = os.path.join(out_category, f"{voice_id}_asr.txt")
        out_json = os.path.join(out_category, f"{voice_id}_asr.json")

        # 复制音频
        with sf.SoundFile(audio_path) as src:
            sf.write(out_audio, audio_array, 16000)

        # 保存识别文本
        with open(out_txt, "w", encoding="utf-8") as f:
            f.write(recognized_text)

        # 保存完整 JSON
        result = {
            "id": voice_id,
            "name": voice["name"],
            "category": category,
            "gender": voice["gender"],
            "age": voice["age"],
            "language": voice["language"],
            "duration_seconds": round(audio_len, 2),
            "original_text": original_text,
            "recognized_text": recognized_text,
        }
        with open(out_json, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)

        print(f"{elapsed:.1f}s ✓")
        results.append(result)

    except Exception as e:
        elapsed = time.time() - t1
        print(f"{elapsed:.1f}s ✗ {e}")
        results.append({
            "id": voice_id,
            "name": voice["name"],
            "category": category,
            "gender": voice["gender"],
            "age": voice["age"],
            "language": voice["language"],
            "duration_seconds": round(audio_len, 2),
            "original_text": original_text,
            "recognized_text": f"[ERROR] {e}",
        })

# ─── 总览输出 ───
with open(JSON_OUT, "w", encoding="utf-8") as f:
    json.dump(results, f, ensure_ascii=False, indent=2)

with open(CSV_OUT, "w", encoding="utf-8-sig", newline="") as f:
    if results:
        w = csv.DictWriter(f, fieldnames=list(results[0].keys()))
        w.writeheader()
        w.writerows(results)

print()
print("=" * 60)
print(f"识别完成! 共 {len(results)} 个音频")
print(f"总识别耗时: {total_time:.1f}s")
print()
print("输出目录结构:")
print(f"  {OUTPUT_DIR}/")
print(f"  ├── asr_results.csv")
print(f"  ├── asr_results.json")
print(f"  ├── 影视解说/")
print(f"  │   ├── movie_narrator_male.wav  (16kHz)")
print(f"  │   ├── movie_narrator_male_asr.txt")
print(f"  │   └── movie_narrator_male_asr.json")
print(f"  ├── 情感语录/")
print(f"  └── ...")
print("=" * 60)
