import torch
import soundfile as sf
import os
import csv
import io
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

MODEL_PATH = r"E:\electron\qwenASR\model\Qwen3-TTS-12Hz-1.7B-VoiceDesign"
BASE_DIR = r"E:\electron\qwenASR\voice_design"
os.environ["PATH"] += r";C:\Program Files (x86)\sox-14-4-2"
CSV_PATH = os.path.join(BASE_DIR, "voice_library.csv")

# ====== 知识科普 - 东北方言 ======
KEJI_TEXTS = [
    "艾玛，你可不知道，东北冬天那冷是真冷，零下三四十度都正常，铁栏杆舔一口舌头就粘上，你寻思那是开玩笑呢啊？",
    "东北话老有意思了，整一个'整'字能代表好几十种意思，整饭就是做饭、整两句就是聊两句、整挺好啊就是干得不错，你琢磨琢磨这玩意儿多带劲。",
    "东北人管土豆叫地蛋，管瓜子叫毛嗑，管膝盖叫波棱盖儿，管腋窝叫胳肢窝，你搁东北待两天，说话立马就变味儿。",
]

KEJI_DONGBEI = [
    {
        "id": "dongbei_deep_old",
        "name": "东北低沉老爷子",
        "gender": "男",
        "age": "老年",
        "lang": "Chinese",
        "text": KEJI_TEXTS[0],
        "instruct": "东北口音的老年男性，声音极度低沉浑厚，胸腔共鸣像低音炮一样扎实，语速偏慢底气足，沙哑中带着东北老铁特有的硬朗和实诚，像东北农村炕头的老大爷在唠嗑，嗓门大中气足。",
    },
    {
        "id": "dongbei_husky_male",
        "name": "东北烟酒嗓大叔",
        "gender": "男",
        "age": "中年",
        "lang": "Chinese",
        "text": KEJI_TEXTS[1],
        "instruct": "东北口音的中年男性，典型的烟酒嗓，声音沙哑粗糙像砂纸磨过，低沉带颗粒感，语气豪爽不羁，透着东北酒桌上喝出来的爷们儿气，说话实在不玩虚的，偶尔带个'艾玛'的特有腔调。",
    },
    {
        "id": "dongbei_baritone",
        "name": "东北男中音",
        "gender": "男",
        "age": "中年",
        "lang": "Chinese",
        "text": KEJI_TEXTS[2],
        "instruct": "东北口音的中年男性，标准男中音，声音浑厚圆润有质感，胸腔共鸣饱满，低沉但不沙哑，带着成熟男性特有的磁性，像东北电视台的老牌播音员在用地道东北话讲故事，语气亲切自然。",
    },
    {
        "id": "dongbei_gravelly",
        "name": "东北砂纸嗓",
        "gender": "男",
        "age": "中年",
        "lang": "Chinese",
        "text": KEJI_TEXTS[0],
        "instruct": "东北口音的中年男性，嗓音像砂纸打磨过一样粗粝，低音区带粗糙颗粒感，语速偏快嗓门大，带着东北老工业基地那种糙汉子的直爽和热情，说话冲但不让人讨厌，特有感染力。",
    },
    {
        "id": "dongbei_chesty_guy",
        "name": "东北胸腔共鸣青年",
        "gender": "男",
        "age": "青年",
        "lang": "Chinese",
        "text": KEJI_TEXTS[1],
        "instruct": "东北口音的年轻男性，声音低厚有磁性，胸腔共鸣强烈，像低音炮一样扎实，不是清亮的小伙嗓而是成熟的低音，带着东北年轻人特有的幽默和仗义感，说话利索不拖泥带水。",
    },
    {
        "id": "dongbei_rough_elder",
        "name": "东北粗犷老大爷",
        "gender": "男",
        "age": "老年",
        "lang": "Chinese",
        "text": KEJI_TEXTS[2],
        "instruct": "东北口音的老年男性，声音粗犷洪亮底气足，沙哑中带着硬朗倔强，语速偏快嗓门大，像东北林场退休的老师傅，说话直来直去不拐弯，透着老东北爷们儿的豪爽和实在劲儿。",
    },
]

# ====== 搞笑段子 - 东北段子手 ======
DUANZI_TEXTS = [
    "哎呀妈呀你可拉倒吧！就你那两下子还想跟我掰扯？我跟你说你指定是不行！你整那玩意儿搁谁谁不得懵啊？",
    "今天我必须跟大家说道说道，就我邻居那大哥，你说他虎不虎，大冬天穿个拖鞋出去取快递，好家伙，回来波棱盖儿都冻红了！",
    "你可别在那瞎整了！我瞅你那个样就来气，你说你整不明白你搁那瞎比划啥呢？赶紧消停的吧，别到时候整秃噜了又找我。",
    "不是吹啊，就咱东北这块，你搁大街上随便拽个人都能跟你整两句相声，要贫嘴咱是专业的，但要论实在，那更是一等一的！",
]

DUANZI_DONGBEI = [
    {
        "id": "dongbei_duanzi_lao",
        "name": "东北段子手-老大爷",
        "gender": "男",
        "age": "老年",
        "lang": "Chinese",
        "text": DUANZI_TEXTS[0],
        "instruct": "东北口音的老年男性，声音沙哑粗犷底气足嗓门大，胸腔共鸣强，说话带着东北老头特有的倔劲儿和幽默感，像公园里跟人抬杠的老大爷，语气夸张有戏剧性，越说越来劲。",
    },
    {
        "id": "dongbei_duanzi_husky",
        "name": "东北段子手-烟酒嗓",
        "gender": "男",
        "age": "中年",
        "lang": "Chinese",
        "text": DUANZI_TEXTS[1],
        "instruct": "东北口音的中年男性，典型烟酒嗓，声音粗糙沙哑带颗粒感，低沉有磁性，语气豪爽不羁带调侃，像东北烧烤摊上喝了几瓶啤酒的哥们儿，讲起段子来一套一套的，特有画面感。",
    },
    {
        "id": "dongbei_duanzi_chesty",
        "name": "东北段子手-低音炮",
        "gender": "男",
        "age": "青年",
        "lang": "Chinese",
        "text": DUANZI_TEXTS[2],
        "instruct": "东北口音的年轻男性，声音低厚有磁性带胸腔共鸣，不同于一般年轻人的清亮，他的低音炮嗓音讲段子特别有反差感，语气幽默夸张带节奏，像东北抖音上的幽默博主在拍搞笑视频。",
    },
    {
        "id": "dongbei_duanzi_baritone",
        "name": "东北段子手-男中音",
        "gender": "男",
        "age": "中年",
        "lang": "Chinese",
        "text": DUANZI_TEXTS[3],
        "instruct": "东北口音的中年男性，标准男中音，声音浑厚饱满有质感，胸腔共鸣丰富，语气自信洒脱带东北人特有的幽默和贫嘴，像专业东北脱口秀演员在台上逗观众笑，节奏感强。",
    },
]


def get_existing_ids():
    if not os.path.isfile(CSV_PATH):
        return set()
    with open(CSV_PATH, encoding="utf-8-sig") as f:
        return {r["id"] for r in csv.DictReader(f)}


def generate_voices(model, category, voices, csv_rows_to_add):
    os.makedirs(os.path.join(BASE_DIR, category), exist_ok=True)
    existing_ids = get_existing_ids()

    for voice in voices:
        vid = voice["id"]
        if vid in existing_ids:
            print(f"  跳过 {vid}（已存在）")
            continue

        print(f"  生成 [{vid}] {voice['name']}...")

        try:
            wavs, sr = model.generate_voice_design(
                text=voice["text"],
                language=voice["lang"],
                instruct=voice["instruct"],
            )
            audio = wavs[0] if isinstance(wavs, list) else wavs
        except Exception as e:
            print(f"    生成失败: {e}")
            continue

        duration = len(audio) / sr
        if duration < 0.5:
            print(f"    音频太短 ({duration:.2f}s)，跳过")
            continue

        prefix = os.path.join(category, vid)
        wav_path = os.path.join(BASE_DIR, f"{prefix}.wav")
        prompt_path = os.path.join(BASE_DIR, f"{prefix}_prompt.txt")
        text_path = os.path.join(BASE_DIR, f"{prefix}_text.txt")

        sf.write(wav_path, audio, sr)
        with open(prompt_path, "w", encoding="utf-8") as f:
            f.write(voice["instruct"].strip())
        with open(text_path, "w", encoding="utf-8") as f:
            f.write(voice["text"].strip())

        info = sf.SoundFile(wav_path)
        print(f"    {info.samplerate}Hz, {len(info)/info.samplerate:.1f}s")

        csv_rows_to_add.append({
            "id": vid,
            "name": voice["name"],
            "category": category,
            "gender": voice["gender"],
            "age": voice["age"],
            "language": voice["lang"],
            "audio_file": f"{prefix}.wav",
            "prompt_file": f"{prefix}_prompt.txt",
            "text_file": f"{prefix}_text.txt",
            "duration_seconds": round(duration, 2),
        })


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
    print("模型加载完成\n")

    csv_rows = []

    print("=" * 50)
    print("知识科普 - 东北方言 (6个)")
    print("=" * 50)
    generate_voices(model, "知识科普", KEJI_DONGBEI, csv_rows)

    print("\n" + "=" * 50)
    print("搞笑段子 - 东北段子手 (4个)")
    print("=" * 50)
    generate_voices(model, "搞笑段子", DUANZI_DONGBEI, csv_rows)

    if csv_rows:
        is_new = not os.path.isfile(CSV_PATH)
        with open(CSV_PATH, "a", encoding="utf-8-sig", newline="") as f:
            w = csv.DictWriter(f, fieldnames=csv_rows[0].keys())
            if is_new:
                w.writeheader()
            w.writerows(csv_rows)

    print(f"\n全部完成! 新增 {len(csv_rows)} 个声音")


if __name__ == "__main__":
    main()
