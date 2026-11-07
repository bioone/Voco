import torch
import soundfile as sf
import os
import json
import csv
import time
import sys
import io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

MODEL_PATH = r"E:\electron\qwenASR\model\Qwen3-TTS-12Hz-1.7B-VoiceDesign"
BASE_DIR = r"E:\electron\qwenASR\voice_design"
CSV_PATH = os.path.join(BASE_DIR, "voice_library.csv")
os.environ["PATH"] += r";C:\Program Files (x86)\sox-14-4-2"

# ========== 声音定义: category -> [voices] ==========
VOICES = {
    "影视解说": [
        {
            "id": "movie_narrator_male",
            "name": "影视解说-男",
            "gender": "男",
            "age": "中年",
            "lang": "Chinese",
            "text": "注意看，这个男人叫小帅，他万万没有想到，接下来发生的事情将彻底改变他的人生。",
            "instruct": "低沉浑厚的中年男性旁白，语速适中略快，咬字清晰有力，声音富有磁性和故事感，像专业影视解说博主。",
        },
        {
            "id": "movie_narrator_female",
            "name": "影视解说-女",
            "gender": "女",
            "age": "中年",
            "lang": "Chinese",
            "text": "注意看，这个女人叫小美，她在深夜独自走进了那栋废弃的大楼，浑然不知危险正在逼近。",
            "instruct": "成熟知性的女性旁白，语速平稳，语气冷静客观，略带悬疑感，声音清晰有质感。",
        },
        {
            "id": "movie_suspense",
            "name": "悬疑解说",
            "gender": "男",
            "age": "中年",
            "lang": "Chinese",
            "text": "当警察打开那扇门的那一刻，所有人都惊呆了。谁能想到，真相竟然如此令人毛骨悚然。",
            "instruct": "低沉沙哑的男性声音，语速缓慢，刻意压低嗓音制造悬疑感，停顿恰到好处，营造紧张氛围。",
        },
    ],
    "情感语录": [
        {
            "id": "emotion_warm_female",
            "name": "温暖女声",
            "gender": "女",
            "age": "青年",
            "lang": "Chinese",
            "text": "人这一生，总会有一个人让你觉得，所有的等待都是值得的。",
            "instruct": "温柔细腻的年轻女性声音，语速缓慢，语气柔和治愈，声音轻柔温暖，像深夜电台的知心姐姐。",
        },
        {
            "id": "emotion_sad_male",
            "name": "伤感男声",
            "gender": "男",
            "age": "青年",
            "lang": "Chinese",
            "text": "后来我才明白，有些人一旦错过，就真的再也回不去了。",
            "instruct": "低沉忧郁的年轻男性声音，语速缓慢，带有淡淡的忧伤和无奈，声音沙哑有磁性，充满故事感。",
        },
        {
            "id": "emotion_healing",
            "name": "治愈系",
            "gender": "女",
            "age": "青年",
            "lang": "Chinese",
            "text": "没关系的，一切都会好起来的。你要相信，这个世界总有人在偷偷爱着你。",
            "instruct": "甜美温柔的年轻女性声音，语速缓慢轻柔，语气充满关怀和安慰，像好朋友在耳边轻声安慰。",
        },
    ],
    "搞笑段子": [
        {
            "id": "funny_dialect",
            "name": "东北话搞笑",
            "gender": "男",
            "age": "青年",
            "lang": "Chinese",
            "text": "哎呀妈呀，你可拉倒吧！就你那两下子，还想跟我掰扯掰扯？我跟你说，你指定是不行！",
            "instruct": "夸张搞笑的东北口音，语速快，音调起伏大，语气夸张充满喜感，带有明显的东北方言特色。",
        },
        {
            "id": "funny_sichuan",
            "name": "四川话搞笑",
            "gender": "男",
            "age": "青年",
            "lang": "Chinese",
            "text": "你莫要逗我哦，这个事情哪有恁个简单嘛！我给你说，你怕是想多了哦。",
            "instruct": "幽默风趣的四川口音，语调上扬，语气轻松调侃，带有四川方言的独特韵味和搞笑感。",
        },
        {
            "id": "funny_cantonese",
            "name": "粤语搞笑",
            "gender": "男",
            "age": "青年",
            "lang": "Chinese",
            "text": "搞错啊大佬！你唔系啊嘛？呢个嘢都搞唔掂，你点出嚟行噶？",
            "instruct": "搞笑夸张的广东口音，语速快，语气充满调侃和不可思议，带有粤语的独特节奏感。",
        },
    ],
    "知识科普": [
        {
            "id": "knowledge_male",
            "name": "科普男声",
            "gender": "男",
            "age": "青年",
            "lang": "Chinese",
            "text": "你知道吗？人类的大脑每天会产生大约六万个想法，但其中百分之九十五都是重复的。",
            "instruct": "清晰明亮的年轻男性声音，语速适中，语气自信专业，吐字清晰，像知识类短视频博主在讲解科普知识。",
        },
        {
            "id": "knowledge_female",
            "name": "科普女声",
            "gender": "女",
            "age": "青年",
            "lang": "Chinese",
            "text": "今天给大家分享一个冷知识，你知道为什么大部分人都记不住昨天吃了什么吗？",
            "instruct": "清新活泼的年轻女性声音，语速适中略快，语气热情有活力，声音明亮好听，像知识分享类博主。",
        },
        {
            "id": "history_narrator",
            "name": "历史解说",
            "gender": "男",
            "age": "中年",
            "lang": "Chinese",
            "text": "公元前二二一年，秦王嬴政统一六国，建立了中国历史上第一个大一统王朝。",
            "instruct": "浑厚沉稳的中年男性声音，语速缓慢庄重，语气厚重有历史感，像纪录片旁白。",
        },
    ],
    "美食探店": [
        {
            "id": "food_excited",
            "name": "美食探店-兴奋",
            "gender": "女",
            "age": "青年",
            "lang": "Chinese",
            "text": "家人们！这家店也太好吃了吧！你们看看这个色泽，闻闻这个香味，我真的要疯了！",
            "instruct": "兴奋激动的年轻女性声音，语速快，音调高，充满惊喜和热情，像吃到美食后迫不及待想分享的探店博主。",
        },
        {
            "id": "food_calm",
            "name": "美食探店-娓娓道来",
            "gender": "男",
            "age": "青年",
            "lang": "Chinese",
            "text": "这家藏在巷子里的小店，已经开了三十年了。老板说，做菜最重要的就是用心。",
            "instruct": "温和从容的男性声音，语速缓慢，语气温暖有故事感，像在讲述一段美食背后的故事。",
        },
    ],
    "励志鸡汤": [
        {
            "id": "inspire_passionate",
            "name": "热血励志",
            "gender": "男",
            "age": "青年",
            "lang": "Chinese",
            "text": "不要因为没有掌声就放弃梦想！你需要的不是认可，而是坚持！加油！",
            "instruct": "充满激情的年轻男性声音，语速快，音量偏高，语气坚定有力，充满感染力和号召力。",
        },
        {
            "id": "inspire_calm",
            "name": "温柔励志",
            "gender": "女",
            "age": "青年",
            "lang": "Chinese",
            "text": "慢慢来，不要急。你只需要每天进步一点点，时间会给你想要的答案。",
            "instruct": "温柔坚定的年轻女性声音，语速缓慢，语气柔和但有力量，像在温柔地鼓励和开导。",
        },
    ],
    "旅行Vlog": [
        {
            "id": "travel_energetic",
            "name": "活力旅行",
            "gender": "女",
            "age": "青年",
            "lang": "Chinese",
            "text": "大家好，我现在在大理洱海边！这里的风景真的太美了，天蓝水碧，简直就是人间仙境！",
            "instruct": "阳光开朗的年轻女性声音，语速快，语气兴奋愉悦，充满活力，像旅行博主在分享美景。",
        },
        {
            "id": "travel_chill",
            "name": "文艺旅行",
            "gender": "男",
            "age": "青年",
            "lang": "Chinese",
            "text": "一个人，一台相机，一段旅程。走在陌生的街道上，感受这座城市独特的呼吸。",
            "instruct": "慵懒文艺的年轻男性声音，语速缓慢，语气平静从容，声音低沉有磁性，像文艺纪录片旁白。",
        },
    ],
    "带货直播": [
        {
            "id": "live_selling_female",
            "name": "带货女主播",
            "gender": "女",
            "age": "青年",
            "lang": "Chinese",
            "text": "三二一上链接！今天这个价格真的是全网最低！买到就是赚到！赶紧下单！",
            "instruct": "高亢热情的年轻女性声音，语速极快，声音洪亮有穿透力，充满紧迫感和煽动性，典型的直播带货风格。",
        },
        {
            "id": "live_selling_male",
            "name": "带货男主播",
            "gender": "男",
            "age": "青年",
            "lang": "Chinese",
            "text": "家人们看好了啊！这个质量，这个价格，外面你绝对找不到第二家！最后五百单！",
            "instruct": "豪爽热情的年轻男性声音，语速快，声音洪亮，语气充满自信和煽动力。",
        },
    ],
    "悬疑故事": [
        {
            "id": "horror_story",
            "name": "恐怖故事",
            "gender": "男",
            "age": "中年",
            "lang": "Chinese",
            "text": "午夜十二点，楼道里传来了脚步声。可是，整层楼只有她一个人住。",
            "instruct": "低沉阴森的男性声音，语速极慢，刻意压低声音，语气充满恐惧和神秘感，让人毛骨悚然。",
        },
        {
            "id": "crime_story",
            "name": "刑侦故事",
            "gender": "男",
            "age": "中年",
            "lang": "Chinese",
            "text": "现场没有留下任何指纹，但侦探注意到窗台上有一根不起眼的红色丝线。",
            "instruct": "沉稳冷静的中年男性声音，语速适中，语气理性客观，像刑侦纪录片的旁白。",
        },
    ],
    "动漫配音": [
        {
            "id": "anime_shounen",
            "name": "热血少年",
            "gender": "男",
            "age": "少年",
            "lang": "Chinese",
            "text": "我绝不会放弃！无论对手有多强，我都要守护我最重要的人！这就是我的忍道！",
            "instruct": "热血激昂的少年声音，音调高，语速快，充满斗志和决心，像热血动漫的男主角。",
        },
        {
            "id": "anime_loli",
            "name": "可爱萝莉",
            "gender": "女",
            "age": "少女",
            "lang": "Chinese",
            "text": "姐姐姐姐！你看你看，这个好可爱呀！我好喜欢！我们可以带它回家吗？",
            "instruct": "稚嫩可爱的萝莉声音，音调很高，语气天真烂漫，充满童趣和撒娇的感觉。",
        },
        {
            "id": "anime_boss",
            "name": "霸气Boss",
            "gender": "男",
            "age": "中年",
            "lang": "Chinese",
            "text": "蝼蚁之辈，也敢在我面前放肆？就让你们见识一下，什么才是真正的力量。",
            "instruct": "低沉威严的成熟男性声音，语速缓慢，语气傲慢霸气，充满压迫感和统治力。",
        },
    ],
    "英文风格": [
        {
            "id": "english_motivational",
            "name": "英文励志",
            "gender": "男",
            "age": "青年",
            "lang": "English",
            "text": "Believe in yourself. You are braver than you think, more talented than you know, and capable of more than you imagine.",
            "instruct": "Confident and warm male voice, clear articulation, motivational and uplifting tone, inspiring like a TED speaker.",
        },
        {
            "id": "english_storyteller",
            "name": "英文故事",
            "gender": "女",
            "age": "青年",
            "lang": "English",
            "text": "Once upon a time, in a land far beyond the mountains, there lived a young girl who dreamed of exploring the world.",
            "instruct": "Gentle and expressive female narrator voice, warm and engaging, perfect for audiobook storytelling.",
        },
        {
            "id": "english_news",
            "name": "英文新闻",
            "gender": "男",
            "age": "中年",
            "lang": "English",
            "text": "Good evening. Tonight we bring you breaking news from around the world. The global economy is showing signs of recovery.",
            "instruct": "Professional and authoritative male news anchor voice, clear diction, steady pace, formal broadcast style.",
        },
    ],
    "日韩风格": [
        {
            "id": "japanese_kawaii",
            "name": "日系可爱",
            "gender": "女",
            "age": "少女",
            "lang": "Japanese",
            "text": "みなさんこんにちは！今日はとっても楽しい一日になりそうです！一緒にがんばりましょう！",
            "instruct": "元気いっぱいの若い女性の声、明るく可爱的い、声のトーンが高く、活発で親しみやすい感じ。",
        },
        {
            "id": "korean_emotional",
            "name": "韩系情感",
            "gender": "女",
            "age": "青年",
            "lang": "Korean",
            "text": "그때의 우리는 정말로 행복했었는데, 왜 다시는 돌아갈 수 없는 걸까요.",
            "instruct": "감성적인 젊은 여성의 목소리, 차분하고 서정적인 어조, 약간의 슬픔이 묻어나는 아련한 느낌.",
        },
    ],
    "角色扮演": [
        {
            "id": "rp_doctor",
            "name": "温和医生",
            "gender": "男",
            "age": "中年",
            "lang": "Chinese",
            "text": "您的检查结果一切正常，不用太担心。平时注意休息，按时服药就好。",
            "instruct": "温和专业的中年男性医生，语速平稳，语气令人安心，声音沉稳可靠。",
        },
        {
            "id": "rp_teacher",
            "name": "严厉老师",
            "gender": "女",
            "age": "中年",
            "lang": "Chinese",
            "text": "这道题我已经讲了多少遍了？你们怎么还是不会？下次再错就给我抄一百遍！",
            "instruct": "严厉的中年女教师声音，语气强硬，带有训斥和恨铁不成钢的感觉，声音尖锐有压迫感。",
        },
        {
            "id": "rp_little_boy",
            "name": "活泼小男孩",
            "gender": "男",
            "age": "儿童",
            "lang": "Chinese",
            "text": "妈妈妈妈！我今天在学校得了一朵小红花！老师还夸我了呢！",
            "instruct": "活泼天真的小男孩声音，音调高且充满兴奋，语速较快，充满童趣。",
        },
        {
            "id": "rp_elderly",
            "name": "慈祥老爷爷",
            "gender": "男",
            "age": "老年",
            "lang": "Chinese",
            "text": "从前啊，在一个很远很远的山村里，住着一位白发苍苍的老奶奶。",
            "instruct": "慈祥沧桑的老年男性声音，语速缓慢，嗓音沙哑低沉，像爷爷在给孙子讲故事。",
        },
    ],
}


def create_dirs():
    """创建目录结构"""
    os.makedirs(BASE_DIR, exist_ok=True)
    for category in VOICES:
        folder = os.path.join(BASE_DIR, category)
        os.makedirs(folder, exist_ok=True)


def generate_all():
    """生成所有声音"""
    from qwen_tts import Qwen3TTSModel

    create_dirs()

    print("=" * 60)
    print("Qwen3-TTS VoiceDesign 抖音声音库")
    print("=" * 60)
    print(f"GPU: {torch.cuda.get_device_name(0)}")
    print(f"输出目录: {BASE_DIR}")
    total_voices = sum(len(v) for v in VOICES.values())
    print(f"共 {total_voices} 种声音, {len(VOICES)} 个分类")
    print()

    print("正在加载模型...")
    t0 = time.time()
    model = Qwen3TTSModel.from_pretrained(
        MODEL_PATH,
        device_map="cuda:0",
        dtype=torch.bfloat16,
    )
    print(f"模型加载完成! 耗时: {time.time() - t0:.1f} 秒\n")

    csv_rows = []
    idx = 0
    for category, voices in VOICES.items():
        folder = os.path.join(BASE_DIR, category)
        print(f"{'=' * 40} {category} {'=' * 40}")
        for v in voices:
            idx += 1
            audio_path = os.path.join(folder, f"{v['id']}.wav")
            prompt_path = os.path.join(folder, f"{v['id']}_prompt.txt")
            text_path = os.path.join(folder, f"{v['id']}_text.txt")

            # 检查是否已生成
            if os.path.exists(audio_path):
                info = sf.info(audio_path)
                duration = info.duration
                print(f"  [{idx}/{total_voices}] {v['name']} - 已存在, 跳过")
            else:
                print(f"  [{idx}/{total_voices}] {v['name']} - 生成中...")
                t1 = time.time()
                wavs, sr = model.generate_voice_design(
                    text=v["text"],
                    language=v["lang"],
                    instruct=v["instruct"],
                )
                elapsed = time.time() - t1
                sf.write(audio_path, wavs[0], sr)
                duration = len(wavs[0]) / sr
                print(f"           耗时: {elapsed:.1f}s | 时长: {duration:.1f}s")

            # 保存 prompt
            with open(prompt_path, "w", encoding="utf-8") as f:
                f.write(v["instruct"])

            # 保存 text
            with open(text_path, "w", encoding="utf-8") as f:
                f.write(v["text"])

            csv_rows.append({
                "id": v["id"],
                "name": v["name"],
                "category": category,
                "gender": v["gender"],
                "age": v["age"],
                "language": v["lang"],
                "audio_file": f"{category}/{v['id']}.wav",
                "prompt_file": f"{category}/{v['id']}_prompt.txt",
                "text_file": f"{category}/{v['id']}_text.txt",
                "duration_seconds": round(duration, 2),
            })

    # 写 CSV 总览
    with open(CSV_PATH, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=csv_rows[0].keys())
        writer.writeheader()
        writer.writerows(csv_rows)

    print()
    print("=" * 60)
    print(f"全部完成! 共 {total_voices} 个声音")
    print(f"目录结构: {BASE_DIR}/")
    print(f"  ├── voice_library.csv (总览)")
    print(f"  ├── 影视解说/")
    print(f"  ├── 情感语录/")
    print(f"  ├── ...")
    print(f"CSV 总览: {CSV_PATH}")
    print("=" * 60)


if __name__ == "__main__":
    generate_all()
