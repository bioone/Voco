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
    # ════════ 天津方言 · 不同年龄性别风格 ════════
    {
        "id": "tianjin_young_girl",
        "name": "天津甜妹科普",
        "gender": "女",
        "age": "青年",
        "text": "哎哟喂您猜怎么着？天津的煎饼果子啊，非得夹果篦儿，您夹根火腿肠那就不正宗了！这是规矩！",
        "instruct": "天津口音的年轻女性声音，声音清脆甜美，语气活泼俏皮带点撒娇，语速快，天津话味儿足，像天津本地的可爱小姑娘在热情地给外地朋友介绍家乡。",
    },
    {
        "id": "tianjin_middle_woman",
        "name": "天津大姐科普",
        "gender": "女",
        "age": "中年",
        "text": "嘛玩儿？您说天津快板儿不好学？我告诉您呐，这事儿就得勤练！嘴皮子利索了，啥都能说！",
        "instruct": "天津口音的中年女性声音，声音洪亮爽朗，语气热情泼辣，语速快，带着天津人特有的直爽和幽默感，像街坊热心肠的天津阿姨在跟人唠嗑。",
    },
    {
        "id": "tianjin_old_man",
        "name": "天津大爷科普",
        "gender": "男",
        "age": "老年",
        "text": "嘿！我跟您说啊，这天津卫的早点，那可是一绝！老豆腐、锅巴菜，您吃一回保管想第二回！",
        "instruct": "天津口音的老年男性声音，声音沙哑沧桑但精神头足，语气慢悠悠带着得意，像天津河边遛鸟的大爷在跟年轻人摆龙门阵，透着老天津卫的傲娇。",
    },
    {
        "id": "tianjin_young_guy",
        "name": "天津小哥科普",
        "gender": "男",
        "age": "青年",
        "text": '跟您这么说吧，天津人管「可爱」叫「耐人」，管「厉害」叫「牛掰」，您要夸天津姑娘好看，得说「真俊」！',
        "instruct": "天津口音的年轻男性声音，语气油滑逗趣，语速快，带着天津街头小青年特有的贫嘴和幽默感，像在天津相声茶馆里长大的小伙子在教人说天津话。",
    },
    {
        "id": "tianjin_crosstalk",
        "name": "天津相声解说",
        "gender": "男",
        "age": "中年",
        "text": "您说这狗不理包子为嘛叫狗不理？可不是狗都不理啊！那是有故事的！来来来，我给您讲讲。",
        "instruct": "天津口音的中年男性声音，带相声演员的腔调，语气夸张有舞台感，抑扬顿挫分明，语速时快时慢，像天津茶馆里的相声演员在说段子，幽默风趣。",
    },
    {
        "id": "tianjin_teen_boy",
        "name": "天津小爷们科普",
        "gender": "男",
        "age": "少年",
        "text": '姐啊，您知道嘛？咱天津那个「天津之眼」摩天轮，转到最高处能看见大半个天津卫，倍儿带劲！',
        "instruct": "天津口音的少年男孩声音，语气调皮捣蛋，音调偏高，语速快，带着小男生臭显摆的感觉，像天津胡同里半大小子在给小伙伴显摆他知道的事。",
    },
    {
        "id": "tianjin_old_woman",
        "name": "天津奶奶科普",
        "gender": "女",
        "age": "老年",
        "text": "我说孩子啊，这天津的麻花可不是一般的炸面，那是有秘方的！二十多种料，讲究着呢！",
        "instruct": "天津口音的老年女性声音，声音慈祥温和但带点碎碎念的感觉，语速偏慢，像天津老小区里坐在楼下晒太阳的奶奶在给后辈讲老天津的事儿。",
    },

    # ════════ 北京方言 · 不同年龄性别风格 ════════
    {
        "id": "beijing_young_girl",
        "name": "北京大妞科普",
        "gender": "女",
        "age": "青年",
        "text": "哎哟喂您猜怎么着？故宫里头那大缸啊，以前是装水的，防火用的！可不是什么腌咸菜的，您可别闹了。",
        "instruct": "北京口音的年轻女性声音，声音清脆响亮，语气爽朗直率，语速快，带着北京姑娘特有的大气和贫嘴劲儿，像在胡同里长大的北京大妞在给人科普。",
    },
    {
        "id": "beijing_middle_woman",
        "name": "北京阿姨科普",
        "gender": "女",
        "age": "中年",
        "text": "我跟您说啊，这北京的豆汁儿，您别一上来就嫌难喝，得慢慢品！那叫一个地道！",
        "instruct": "北京口音的中年女性声音，声音热情周到，语气絮叨但亲切，语速偏快，像北京胡同里热心肠的居委会大妈在给年轻人讲老北京的讲究。",
    },
    {
        "id": "beijing_old_man",
        "name": "北京大爷科普",
        "gender": "男",
        "age": "老年",
        "text": "您瞧好吧！这北京烤鸭啊，讲究的是皮酥肉嫩，片鸭子的刀工那是有说头的，一百零八片儿，一片儿不能多一片儿不能少！",
        "instruct": "北京口音的老年男性声音，声音沙哑但底气足，语气慢悠悠透着老北京的自信和讲究，像在胡同口下棋的北京大爷在给年轻人传道授业解惑。",
    },
    {
        "id": "beijing_young_guy",
        "name": "北京小哥科普",
        "gender": "男",
        "age": "青年",
        "text": '哥，您知道为什么北京话叫"京片子"吗？就因为这嘴皮子得跟蹦豆儿似的，利索！一句话不带打磕巴儿的。',
        "instruct": "北京口音的年轻男性声音，语气随意散漫带着贫，语速快，儿化音重，像北京南城长大的小青年在跟哥们儿侃大山，透着北京孩子特有的混不吝和幽默。",
    },
    {
        "id": "beijing_narrator",
        "name": "北京说书人",
        "gender": "男",
        "age": "中年",
        "text": '话说这北京城啊，有句老话叫「有名的胡同三千六，没名的胡同赛牛毛」。今儿个咱们就聊聊这胡同里的门道。',
        "instruct": "北京口音的中年男性声音，带传统评书味道，语气抑扬顿挫有韵律，语速适中，像北京天桥说书的艺人，京腔浓郁，讲故事感强。",
    },
    {
        "id": "beijing_teen_girl",
        "name": "北京小妹科普",
        "gender": "女",
        "age": "少女",
        "text": "妈耶！您知道嘛？北京那个大裤衩大楼，其实叫央视总部大楼！设计师还是外国人呢，倍儿有范儿！",
        "instruct": "北京口音的少女声音，声音尖细清脆，语气激动兴奋带点追星女孩的感觉，语速快，儿化音多，像北京的中学生在跟同学分享她觉得特酷的事儿。",
    },
    {
        "id": "beijing_old_woman",
        "name": "北京奶奶科普",
        "gender": "女",
        "age": "老年",
        "text": "哎呦喂，说起这老北京的糖葫芦啊，那可不是现在这种水果串儿。早年间那是山药豆儿的、山楂的，裹上冰糖，咬一口嘎嘣脆！",
        "instruct": "北京口音的老年女性声音，声音慈祥温和带着岁月的沙哑，语速缓慢，语气中带着回忆和感慨，像北京老胡同里的奶奶在给孙辈讲以前的老事儿。",
    },
]

print("=" * 60)
print("天津/北京方言科普 - 新增多风格音色")
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

    if os.path.exists(audio_path):
        info = sf.info(audio_path)
        print(f"[{i+1}/{len(NEW_VOICES)}] {v['name']} - 已存在, 跳过 ({info.duration:.1f}s)")
        continue

    print(f"[{i+1}/{len(NEW_VOICES)}] {v['name']} ({v['gender']}/{v['age']}) ...", end=" ")

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

    print(f"{elapsed:.1f}s | {duration:.1f}s")

# ──── 更新 CSV ────
print(f"\n正在更新 CSV 总览...", end=" ")

rows = []
with open(CSV_PATH, "r", encoding="utf-8-sig") as f:
    reader = csv.DictReader(f)
    rows = list(reader)

existing_ids = {r["id"] for r in rows}

added = 0
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
        added += 1

with open(CSV_PATH, "w", encoding="utf-8-sig", newline="") as f:
    writer = csv.DictWriter(f, fieldnames=rows[0].keys())
    writer.writeheader()
    writer.writerows(rows)

print(f"完成! 新增 {added} 条, 共 {len(rows)} 条记录")

print()
print("=" * 60)
print("全部完成!")
print(f"新增 {len(NEW_VOICES)} 个方言声音到 知识科普/")
print(f"CSV 总览: {CSV_PATH}")
print("=" * 60)
