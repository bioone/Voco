import torch
import soundfile as sf
import os
import csv
import time
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

MODEL_PATH = r"E:\electron\qwenASR\model\Qwen3-TTS-12Hz-1.7B-VoiceDesign"
FOLDER = r"E:\electron\qwenASR\voice_design\知识科普"
CSV_PATH = r"E:\electron\qwenASR\voice_design\voice_library.csv"
os.environ["PATH"] += r";C:\Program Files (x86)\sox-14-4-2"

NEW_VOICES = [
    {
        "id": "knowledge_deep_male",
        "name": "浑厚男主播",
        "gender": "男",
        "age": "中年",
        "text": "今天我们来聊一个非常有趣的话题：宇宙到底有多大？当我们仰望星空，看到的每一颗星星，都可能是一个比太阳还要巨大的恒星。",
        "instruct": "极度浑厚深沉的中年男性声音，胸腔共鸣感极强，声音像大提琴一样低沉厚重，语速沉稳有力，每个字都掷地有声，给人权威可靠的感觉，像BBC纪录片首席旁白。",
    },
    {
        "id": "knowledge_authoritative",
        "name": "权威老教授",
        "gender": "男",
        "age": "老年",
        "text": "在量子力学的世界里，粒子可以同时存在于多个地方。这个看似荒谬的理论，已经被无数实验所证实。",
        "instruct": "沧桑厚重但思维敏锐的老年男性教授声音，语速略慢但中气十足，声音有岁月的沉淀感但逻辑清晰，带有一点沙哑但不失力量，像老院士在讲课。",
    },
    {
        "id": "knowledge_warm_male",
        "name": "温暖大叔科普",
        "gender": "男",
        "age": "中年",
        "text": "其实呢，人类能尝出五种基本味道：酸甜苦咸鲜。而辣其实不是味觉，是一种痛觉。",
        "instruct": "温柔亲切的中年男性声音，声音温暖有磁性，语速平缓，像一位知识渊博的邻居大叔在娓娓道来，语气亲和有感染力。",
    },
    {
        "id": "knowledge_tech_review",
        "name": "数码评测",
        "gender": "男",
        "age": "青年",
        "text": "兄弟们今天给大家开箱一款新发布的旗舰手机。骁龙最新处理器，搭配二十四GB运行内存，性能直接拉满。",
        "instruct": "活力四射的年轻男性数码博主声音，语速偏快，声音明亮清晰，语气自信专业，带有科技感，像在评测最新数码产品。",
    },
    {
        "id": "knowledge_mystery",
        "name": "未解之谜",
        "gender": "男",
        "age": "青年",
        "text": "在百慕大三角的海底深处，科学家发现了一座古老的金字塔结构。这座金字塔比埃及的还要大，而且表面异常光滑。",
        "instruct": "低沉而神秘的年轻男性声音，语速适中，带着探究和好奇的语气，时而压低声音增加悬念感，像在讲述未解之谜的科普博主。",
    },
    {
        "id": "knowledge_elderly_warm",
        "name": "慈祥奶奶科普",
        "gender": "女",
        "age": "老年",
        "text": "孩子们，今天奶奶给你们讲讲为什么天空是蓝色的。那是因为阳光照到大气层里，被小颗粒散射开了。",
        "instruct": "慈祥温和的老年女性声音，声音柔和沙哑但亲切，语速缓慢，像慈祥的奶奶在给孙辈耐心讲解科学知识，充满关爱感。",
    },
    {
        "id": "knowledge_teen_boy",
        "name": "少年科学迷",
        "gender": "男",
        "age": "少年",
        "text": "哇塞你们知道吗？如果把地球的历史压缩成一天，人类出现的时间连最后一分钟都不到！",
        "instruct": "兴奋好奇的少年男孩声音，音调偏高，语速快，充满探索的热情和发现新知识的激动，像热爱科学的小学生在分享有趣的知识。",
    },
    {
        "id": "knowledge_professional_female",
        "name": "知性女博士",
        "gender": "女",
        "age": "中年",
        "text": "根据最新的考古研究表明，三星堆文明的年代可以追溯到四千八百年前，比我们之前认为的还要早。",
        "instruct": "知性干练的中年女性声音，声音沉稳有力，吐字清晰，语气专业严谨但不刻板，像一位考古学女博士在讲解研究成果。",
    },
    {
        "id": "knowledge_asmr_whisper",
        "name": "助眠科普",
        "gender": "女",
        "age": "青年",
        "text": "想象一下，你正漂浮在一片温暖的海洋上。海水轻轻托着你的身体，海浪声在耳边缓缓回荡。",
        "instruct": "极其轻柔舒缓的年轻女性声音，音量极低近乎耳语，语速非常缓慢，声音温柔丝滑，像ASMR助眠主播在轻声引导冥想，营造完全放松的氛围。",
    },
    {
        "id": "knowledge_humorous",
        "name": "幽默科普",
        "gender": "男",
        "age": "青年",
        "text": "大象其实跳不起来，这是真的。你想想看，一头六吨重的大家伙要跳起来，那画面也太美了。",
        "instruct": "轻松幽默的年轻男性声音，语速轻快，语气诙谐调侃，带着捉弄和逗乐的感觉，像在讲冷笑话的同时顺便科普知识。",
    },
    {
        "id": "knowledge_tianjin",
        "name": "天津话科普",
        "gender": "男",
        "age": "中年",
        "text": "哎呦喂，跟您这么说吧，这天津眼摩天轮啊，转一圈得半个小时！您别觉得慢，这叫浪漫，懂不？",
        "instruct": "天津口音的中年男性，语气诙谐幽默，语速偏快，带着天津话特有的抑扬顿挫和逗乐感，像天津茶馆里说相声的大叔在讲科普。",
    },
    {
        "id": "knowledge_beijing",
        "name": "北京话科普",
        "gender": "男",
        "age": "青年",
        "text": "您猜怎么着？故宫里头那大缸啊，以前是装水的，防火用的！可不是什么腌咸菜的，您可别闹了。",
        "instruct": "北京口音的年轻男性，语气油滑逗趣，语速快，带着北京话特有的儿化音和贫嘴感，像在北京胡同里长大的小哥在侃大山。",
    },
]

print("=" * 60)
print("知识科普 - 新增多风格声音")
print("=" * 60)
print(f"GPU: {torch.cuda.get_device_name(0)}")
print(f"新增 {len(NEW_VOICES)} 种声音")
print()

print("正在加载模型...")
t0 = time.time()
from qwen_tts import Qwen3TTSModel

model = Qwen3TTSModel.from_pretrained(
    MODEL_PATH,
    device_map="cuda:0",
    dtype=torch.bfloat16,
)
print(f"模型加载完成! 耗时: {time.time() - t0:.1f} 秒\n")

total_time = 0
for i, v in enumerate(NEW_VOICES):
    audio_path = os.path.join(FOLDER, f"{v['id']}.wav")
    prompt_path = os.path.join(FOLDER, f"{v['id']}_prompt.txt")
    text_path = os.path.join(FOLDER, f"{v['id']}_text.txt")

    print(f"[{i+1}/{len(NEW_VOICES)}] {v['name']} ({v['gender']}/{v['age']})")

    t1 = time.time()
    wavs, sr = model.generate_voice_design(
        text=v["text"],
        language="Chinese",
        instruct=v["instruct"],
    )
    elapsed = time.time() - t1
    total_time += elapsed

    sf.write(audio_path, wavs[0], sr)
    duration = len(wavs[0]) / sr

    with open(prompt_path, "w", encoding="utf-8") as f:
        f.write(v["instruct"])
    with open(text_path, "w", encoding="utf-8") as f:
        f.write(v["text"])

    print(f"  耗时: {elapsed:.1f}s | 时长: {duration:.1f}s | {v['id']}.wav\n")

# ──── 更新 CSV ────
print("=" * 60)
print("正在更新 CSV 总览...", end=" ")

# 读原有 CSV
rows = []
with open(CSV_PATH, "r", encoding="utf-8-sig") as f:
    reader = csv.DictReader(f)
    for row in reader:
        rows.append(row)

existing_ids = {r["id"] for r in rows}

# 只追加新ID
for v in NEW_VOICES:
    if v["id"] not in existing_ids:
        audio_path = os.path.join(FOLDER, f"{v['id']}.wav")
        info = sf.info(audio_path)
        rows.append({
            "id": v["id"],
            "name": v["name"],
            "category": "知识科普",
            "gender": v["gender"],
            "age": v["age"],
            "language": "Chinese",
            "audio_file": f"知识科普/{v['id']}.wav",
            "prompt_file": f"知识科普/{v['id']}_prompt.txt",
            "text_file": f"知识科普/{v['id']}_text.txt",
            "duration_seconds": round(info.duration, 2),
        })

with open(CSV_PATH, "w", encoding="utf-8-sig", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=rows[0].keys())
    writer.writeheader()
    writer.writerows(rows)

print(f"完成! 现有 {len(rows)} 条记录")
print()

print("=" * 60)
print("全部完成!")
print(f"新增 {len(NEW_VOICES)} 个音频到 知识科普/")
print(f"CSV 已更新: {CSV_PATH}")
print("=" * 60)
