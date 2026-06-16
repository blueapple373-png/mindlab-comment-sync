export default async function handler(req, res) {
  const THREADS_TOKEN = process.env.THREADS_ACCESS_TOKEN;
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const GAS_WEBAPP_URL = process.env.GAS_WEBAPP_URL;

  try {
    // ============================================
    // 1. 自分の投稿一覧を取得
    // ============================================
    const postsRes = await fetch(
      `https://graph.threads.net/v1.0/me/threads?fields=id,text,timestamp&access_token=${THREADS_TOKEN}`
    );
    const postsData = await postsRes.json();

    if (!postsData.data) {
      return res.status(400).json({ error: 'Failed to fetch posts', detail: postsData });
    }

    const allComments = [];

    // ============================================
    // 2. 各投稿への返信（コメント）を取得
    //    repliesフィールドで返信数も取得
    // ============================================
    for (const post of postsData.data) {
      const repliesRes = await fetch(
        `https://graph.threads.net/v1.0/${post.id}/replies?fields=id,text,timestamp,username,replies&access_token=${THREADS_TOKEN}`
      );
      const repliesData = await repliesRes.json();

      if (repliesData.data) {
        repliesData.data.forEach(reply => {
          const replyCount = reply.replies?.data?.length ?? 0;
          allComments.push({
            postId: post.id,
            postText: post.text,
            postTimestamp: post.timestamp,
            replyId: reply.id,
            replyText: reply.text,
            replyTimestamp: reply.timestamp,
            replyCount: replyCount
          });
        });
      }
    }

    if (allComments.length === 0) {
      return res.status(200).json({ status: 'ok', message: 'No comments found', added: 0 });
    }

    // ============================================
    // 3. Claude APIで分類
    // ============================================
    const systemPrompt = `あなたはMINAMI MINDLABのThreadsコメント分析専用AIです。

以下の各コメントについて、以下の項目をJSON配列で出力してください。
日付、投稿タイトル、投稿カテゴリ、投稿タイプ、コメント、読者タイプ、分類、感情キーワード、優先度、返信要否、ネタ候補、保存価値、返信数

■各項目の判定基準

【優先度】
高：深い体験談・長文の自己開示・投稿の核心に触れている・新しい気付きが含まれる・今後の投稿ネタになりそう・返信数が多い
中：体験談はあるが一般的・共感＋短い意見・読者理解には役立つ
低：単純な共感・一般的なアドバイス・応援コメント
不要：営業・勧誘・スパム・内容がほぼないもの

【返信要否】
返信推奨：自己開示・体験談・長文コメント・世界観に共鳴している人
いいねのみ：共感・応援・一般的アドバイス・短文コメント
不要：営業・勧誘・スパム

【保存価値】
高：投稿ネタになる・読者の本音が見える・頻出テーマ・世界観に関わる発言・営業研究に使える・返信数が多い
中：参考にはなる・典型例として残したい
低：既出内容・単純共感・分析価値が低い・応援のみ

■出力ルール
- 営業・勧誘コメントで研究価値が高い場合はネタ候補に「営業研究」と記載
- 不明な項目は「不明」
- JSON配列のみ出力。説明文・マークダウン・バッククォート不要
- フィールド名: date, title, category, type, comment, audienceType, classification, emotionKeywords, priority, replyNeeded, ideaCandidate, saveValue, replyCount`;

    const userPrompt = `以下のコメント一覧を分析してください。\n\n` +
      allComments.map((c, i) =>
        `${i + 1}. 元投稿: ${c.postText}\nコメント: ${c.replyText}\n日時: ${c.replyTimestamp}\n返信数: ${c.replyCount}`
      ).join('\n\n');

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    });

    const claudeData = await claudeRes.json();
    const rawText = claudeData.content[0].text;
    const clean = rawText.replace(/```json|```/g, '').trim();
    const classified = JSON.parse(clean);

    // ============================================
    // 4. GAS Web Appへ送信（スプシに書き込み）
    // ============================================
    const gasRes = await fetch(GAS_WEBAPP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(classified)
    });
    const gasData = await gasRes.json();

    return res.status(200).json({
      status: 'ok',
      commentsFound: allComments.length,
      gasResult: gasData
    });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
