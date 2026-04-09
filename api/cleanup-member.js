/**
 * GET /api/cleanup-member?externalId=cus_xxx
 * PassKitメンバーを手動削除するワンタイムツール
 */
const { getPassKitAuth } = require('../lib/passkit-auth');

module.exports = async function handler(req, res) {
  const externalId = req.query.externalId;
  const passkitId = req.query.passkitId;
  if (!externalId && !passkitId) {
    return res.status(400).json({ error: 'externalId or passkitId query param required' });
  }

  const programId = process.env.PASSKIT_PROGRAM_ID;
  const steps = [];

  try {
    const { token, baseUrl } = getPassKitAuth();
    let memberId = passkitId;

    // passkitIdが指定されていなければexternalIdで検索
    if (!memberId) {
      const getResp = await fetch(`${baseUrl}/members/member/external/${programId}/${externalId}`, {
        method: 'GET',
        headers: { 'Authorization': token },
      });
      const getText = await getResp.text();
      steps.push({ step: 'lookup', status: getResp.status, body: getText.substring(0, 300) });

      if (!getResp.ok) {
        return res.json({ success: false, message: 'Member not found', steps });
      }

      const member = JSON.parse(getText);
      memberId = member.id;
    }

    steps.push({ step: 'found', memberId });

    // ボディ方式で削除
    const delResp = await fetch(`${baseUrl}/members/member`, {
      method: 'DELETE',
      headers: { 'Authorization': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: memberId }),
    });
    const delText = await delResp.text();
    steps.push({ step: 'delete', status: delResp.status, ok: delResp.ok, body: delText.substring(0, 300) });

    return res.json({ success: delResp.ok, steps });
  } catch (err) {
    steps.push({ step: 'error', message: err.message });
    return res.status(500).json({ success: false, steps });
  }
};
