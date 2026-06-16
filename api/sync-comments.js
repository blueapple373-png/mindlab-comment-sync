export default async function handler(req, res) {
  const THREADS_TOKEN = process.env.THREADS_ACCESS_TOKEN;
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const GAS_WEBAPP_URL = process.env.GAS_WEBAPP_URL;

  try {
    // ① 既存コメントID一覧をGASから取得（重複防止）
    const gasGetRes = await fetch(GAS_WEBAPP_URL, { method: 'GET' });
    const gasGetData = await gasGetRes.json();
    const existingIds = new Set(gasGetData.ids || []);

    // ② Threadsから投稿一覧を取得
    const postsRes = await fetch(
      `https://graph.threads.net/v1.0/me/threads?fields=id,text,timestamp&access_token=${THREADS_TOKEN}`
    );
    const postsData = await postsRes.json();

    if (!postsData.data) {
      return res.status(400).json({ error: 'Failed to fetch posts', detail: postsData });
    }

    const allComments = [];

    for (const post of postsData.data) {
      const repliesRes = await fetch(
        `https://graph.threads.net/v1.0/${post.id}/replies?fields=id,text,timestamp,username,replies&access_token=${THREADS_TOKEN}`
      );
      const repliesData = await repliesRes.json();

      if (repliesData.data) {
        repliesData.data.forEach(reply => {
          // ③ 既存IDはスキップ
          if (existingIds.has(reply.id)) return;

          const replyCount = reply.replies?.data?.length ?? 0;
          allComments.push({
            postId: post.id,
            postText: post.text || '',
            postTimestamp: post.timestamp,
            replyId: reply.id,
            replyText: reply.text || '',
            replyTimestamp: reply.timestamp,
            replyCount: replyCount
          });
        });
      }
    }

    if (allComments.length === 0) {
      return res.status(200).json({ status: 'ok', message: 'No new comments', added: 0 });
    }

    const systemPrompt = `あなたはMINAMI MINDLABのThreadsコメント分析専用AIです。

以下の各コメントについて、以下の項目をJSON配列で出力してください。

■各項目の判定基準
【投稿カテゴリ】最も強く当てはまるものを1つだけ選択：
心理・不安・愛着・自己否定・自責・親子関係・アダルトチルドレン・失敗恐怖・行動できない・人間関係・恋愛・承認欲求・孤独・生きづらさ・仕事・HSP・ADHD・回復・境界線・感情・その他・判断できない場合は「その他」を選択

【投稿タイプ】最も強く当てはまるものを1つだけ選択：
コメント・体験談・気づき・問いかけ・構造分析・言語化・比喩・共感・問題提起・失敗談・希望・観察・判断できない場合は「その他」を選択

【読者タイプ】最も強く当てはまるものを1つだけ選択：
一般読者・当事者・回復経験者・支援者・専
