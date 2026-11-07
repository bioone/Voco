import torch
import soundfile as sf
import os
import csv
import io
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

MODEL_PATH = r"E:\electron\qwenASR\model\Qwen3-TTS-12Hz-1.7B-VoiceDesign"
os.environ["PATH"] += r";C:\Program Files (x86)\sox-14-4-2"
BASE_DIR = r"E:\electron\qwenASR\voice_design"
CATEGORY = "知识科普"
CSV_PATH = os.path.join(BASE_DIR, "voice_library.csv")

# 科普文本 —— 每个声音共用多段文本中的一段，增加多样性
TEXTS = [
    "你知道吗？天津话里头这个'嘛'字，那可厉害了，什么场合都能用，问你干嘛呢说'干嘛'，问这是什么说'介是嘛'，语气不一样意思还不一样。",
    "天津人管'勺子'叫'羹匙'，管'蜻蜓'叫'老鹤'，管'麻雀'叫'家雀儿'，你要是跟天津人聊天，这些词儿听不懂可就闹笑话了。",
    "都说天津人说话像说相声，其实是因为天津话的声调跟普通话不太一样，一声变二声，二声变三声，拐来拐去的特有节奏感。",
]

VOICES = [
    {
        "id": "tianjin_deep_old",
        "name": "天津低沉老爷子",
        "gender": "男",
        "age": "老年",
        "lang": "Chinese",
        "text": TEXTS[2],
        "instruct": "天津口音的老年男性，声音极度低沉浑厚，像低音炮一样从胸腔深处发出来，语速缓慢厚重，沙哑中带着老天津卫的沉稳和傲骨，每句话都像从老茶缸子里倒出来的陈年老酒，醇厚有劲儿。",
    },
    {
        "id": "tianjin_husky_uncle",
        "name": "天津烟酒嗓大叔",
        "gender": "男",
        "age": "中年",
        "lang": "Chinese",
        "text": TEXTS[0],
        "instruct": "天津口音的中年男性，典型的烟酒嗓，声音沙哑粗糙磨砂感强，像砂纸磨过一样，低沉有磁性带颗粒感，语气随意洒脱，透着老天津街头混出来的江湖气，说话不紧不慢但底气十足。",
    },
    {
        "id": "tianjin_baritone",
        "name": "天津男中音",
        "gender": "男",
        "age": "中年",
        "lang": "Chinese",
        "text": TEXTS[1],
        "instruct": "天津口音的中年男性，标准男中音，声音浑厚圆润有质感，胸腔共鸣饱满，低沉但不沙哑，带着成熟男性特有的磁性，语气从容自信，像天津电台的老牌播音员在用地道天津话讲故事。",
    },
    {
        "id": "tianjin_gravelly",
        "name": "天津砂纸嗓",
        "gender": "男",
        "age": "中年",
        "lang": "Chinese",
        "text": TEXTS[0],
        "instruct": "天津口音的中年男性，声音像砂纸打磨过一样粗粝有质感，低音区带有明显的粗糙颗粒感，语速稍快，咬字用力，带着天津码头工人那种粗犷豪爽的劲头，嗓门大音量足。",
    },
    {
        "id": "tianjin_chesty_guy",
        "name": "天津胸腔共鸣青年",
        "gender": "男",
        "age": "青年",
        "lang": "Chinese",
        "text": TEXTS[2],
        "instruct": "天津口音的年轻男性，声音低厚有磁性，胸腔共鸣强烈，听起来像低音炮一样扎实，不同于一般年轻人的清亮，他的嗓音低沉稳重中带着天津人特有的贫劲儿，荷尔蒙感十足。",
    },
    {
        "id": "tianjin_rough_elder",
        "name": "天津粗犷老大爷",
        "gender": "男",
        "age": "老年",
        "lang": "Chinese",
        "text": TEXTS[1],
        "instruct": "天津口音的老年男性，声音粗犷洪亮底气十足，沙哑中带着硬朗，语速偏快嗓门大，像天津老工厂退休的老师傅在跟人抬杠，语气爽直不拐弯，透着老天津爷们儿的豪爽和倔强。",
    },
]


def get_existing_ids():
    if not os.path.isfile(CSV_PATH):
        return set()
    with open(CSV_PATH, encoding="utf-8-sig") as f:
        return {r["id"] for r in csv.DictReader(f)}


def main():
    if not torch.cuda.is_available():
        print("CUDA 不可用，请检查 GPU 环境")
        return

    from qwen_tts import Qwen3TTSModel

    print("正在加载 Qwen3-TTS VoiceDesign 模型...")
    model = Qwen3TTSModel.from_pretrained(
        MODEL_PATH,
        device_map="cuda:0",
        dtype=torch.bfloat16,
    )
    print("模型加载完成")

    os.makedirs(os.path.join(BASE_DIR, CATEGORY), exist_ok=True)
    existing_ids = get_existing_ids()

    for voice in VOICES:
        vid = voice["id"]
        if vid in existing_ids:
            print(f"跳过 {vid}（已存在）")
            continue

        print(f"\n生成 [{vid}] {voice['name']}...")
        print(f"  提示: {voice['instruct'][:60]}...")

        try:
            wavs, sr = model.generate_voice_design(
                text=voice["text"],
                language=voice["lang"],
                instruct=voice["instruct"],
            )
            audio = wavs[0] if isinstance(wavs, list) else wavs
        except Exception as e:
            print(f"  生成失败: {e}")
            continue

        duration = len(audio) / sr

        if duration < 0.5:
            print(f"  音频太短 ({duration:.2f}s)，跳过")
            continue

        prefix = os.path.join(CATEGORY, vid)
        wav_path = os.path.join(BASE_DIR, f"{prefix}.wav")
        prompt_path = os.path.join(BASE_DIR, f"{prefix}_prompt.txt")
        text_path = os.path.join(BASE_DIR, f"{prefix}_text.txt")

        sf.write(wav_path, audio, sr)
        with open(prompt_path, "w", encoding="utf-8") as f:
            f.write(voice["instruct"].strip())
        with open(text_path, "w", encoding="utf-8") as f:
            f.write(voice["text"].strip())

        info = sf.SoundFile(wav_path)
        print(f"  采样率: {info.samplerate}Hz, 时长: {len(info) / info.samplerate:.2f}s")

        # 追加到 CSV
        is_new = not os.path.isfile(CSV_PATH)
        with open(CSV_PATH, "a", encoding="utf-8-sig", newline="") as f:
            w = csv.writer(f)
            if is_new:
                w.writerow(["id", "name", "category", "gender", "age", "language",
                            "audio_file", "prompt_file", "text_file", "duration_seconds"])
            w.writerow([vid, voice["name"], CATEGORY, voice["gender"], voice["age"],
                        voice["lang"], f"{prefix}.wav", f"{prefix}_prompt.txt",
                        f"{prefix}_text.txt", f"{duration:.2f}"])

        print(f"  完成: {prefix}.wav ({duration:.2f}s)")

    print("\n全部完成")


if __name__ == "__main__":
    main()
