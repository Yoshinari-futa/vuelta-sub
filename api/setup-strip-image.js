/**
 * GET /setup-strip-image
 * PassKit REST API で strip 画像をアップロードし、テンプレートに紐づける
 *
 * 正しいエンドポイント: POST /images (複数形)
 * Body: { "name": "...", "imageData": { "strip": "<base64>" } }
 *
 * 成功すると imageId を返し、tier/template の imageIds.strip に設定する
 */
const jwt = require('jsonwebtoken');

// strip画像 base64（ビルド時に埋め込み）
const STRIP_IMAGE_BASE64 = `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Pa1Zs2bEiBFHHnlk//79Fy9eXKF/nIqzr776auzYsccee+zQoUNzc3OjH1i1atUxY8YkL9jeJGlKx9Dhhx/+xz/+MdUpSubUU0+dM2fO7373u4jj77nnnsGDByc1UvnbtGlTv379pk2bFnF8RkZGsR8cRXzt0rvvvhtla8Gy3NcXw8U/hpGgFPQlSKVXX301Jycn4uB99903yrAGDRoUO2b+/PkRL1qEvLy8GTNmnH322R999FHZz8be7Ny585577jnllFNKdAtr586dTz/99OSl2ptkTOl4uvHGGyvQExQdOnSYOXNm9FvR/v73vw8dOjSpkVKlsLDwyiuv/PrrryOOb9myZdEDTj311CjN/9FHH33uueeKHXb++eeXepfLGC7+MYwEpaAvQYotWLAg4siqVatGGVazZs1ix0T/WYGY+OCDD0477bT3338/+iH/+Z//mbw8RUj4lI6nAw88cODAgalOEcmZZ545Y8aMrKysiONHjRo1cuTIpEZKra1btz722GMRBx922GFFD4iyWXZBQcGMGTOmT59e7MiaNWuWel/yGC7+MYwEpaAvQYpF/2XYli1bEnXR6C9dIT6++eab7t27f/fddxHHn3baac2aNUtqpKCUTOmUuOaaa6LvMpcq55xzzuOPPx69mt5888133HFHUiPFweLFiyOOrFu3bhHfrV69evfu3Ys9yZIlS7766qu5c+du27at2MFJfVtRDBf/GEaCX9CXIMWiP+H6ww8/RBkW5efp8847L8qv/YibdevWDRo0KPr4Xr16JS/M3iR8SqfQ559/XsR3a9asef3115dbmFLIzs6ePHly9FdyDRkyZOzYsUmNFBNffPFFxJFFfy6XnZ0d5S7HH3dT3L59e5Q99Nu3b9+wYcOI8X4uhot/DCNBKehLkGIRH78uLCz8+OOPo4z85ptvih1Tt27dyZMnV+inR36zZs6c+eKLL0YcfN555yU1TFDCp3QKPfTQQ19++WURA/785z+X/R2jSdK7d++JEydG3MevsLDwmmuuGT9+fLJTxUT0nfqL3j8gymdBeXl5s2bN+vF/R7klLyMjo2/fvtHS/ZsYLv4xjASloC9BikV8d8TatWu///77KCMj3g11xhlnrFq1avDgwVGexyVW7rnnnogjGzduXP4/zSd8SqfQjh07Ro8eXcSAKlWqDBs2rNzyRNevX7+HH364UqVIb1ksKCgYOHDggw8+mOxU8VG/fv2II7dv3763bx1yyCGnnnpqsWdYsGDBT1N9/vz5UT5WLd0ueTFc/GMYCUpBX4IU69y5c5Rh0e+2X7RoUcSRderUGT58+OrVq5csWXLbbbede+650X+GIIVycnI2btwYcXDE958kUMKndGpNmjRpzZo1RQzo06dP06ZNyy1PREOGDIn4Ecru3bv/8pe/PProo0lOFC/t27ePOLKIF/v07ds3ymuXfv5q4127ds2ZM6fYQ5o0aVKKv7kxXPxjGAlKIdJvniDhVq1aVZbDly5d2rFjx0SFSaG2bduedtppUUZOmjQp4jlfeeWV3Nzc6DvSpqent2rVqlWrVldffXVaWtqGDRtWrlz5xv9TipelkmwFBQXPPvts//79oww+/vjjo9wClCjJmNKplZ+fP3LkyCK2U8vIyBg5cmRKHhUru/z8/AEDBjzxxBOpDlKufve731100UURB3/yySd7+1aUu+b2fGbp8ccfj3IX30UXXbRs2bIIAf+/GC7+MYwEpeDzJUiZ9u3bT506NcrIpUuXLl++POJpd+zYEX2r3D3VrVu3c+fON9xww7Rp01avXr1mzZrHHnvssssuO/zww0t9ThIu+g9Sxe6GnEBJmtIpN3PmzBUrVhQxoEuXLieddFK55UmUvLy8/v37/9bKUkZGxr333ht9Y8PXX389+PVTTz01yqo4b968X+yAsmjRoig7aPfs2bOkG+7HcPGPYSQoBX0Jyk+VKlVq167dunXrAQMGzJ07d968efvtt1+xR+Xn5//4m7bo7rrrrry8vFKm/HcNGjQ477zz7rnnnrfeemv58uU33HBDbJ9u/0156623Io485JBDkhej3KZ0yhX7kNKoUaPKJ0mi7Ny5s2/fvrNnz051kHJ1wAEHTJ06NfqHgQUFBS+99FLwWxEfMdrz093du3fPnDmz2AN/97vfde3aNcolfi6Gi38MI0FJ6UuQLKtWrdr277799tvPPvts0aJF48aN69ChQ8Tz3HjjjW+//XaJLv3555/feeedJU5cnKZNmw4bNuzdd9+dMmVKse+8J6mK3uf65w488MBEXTSFUzrlFi1a9Pzzzxcx4KSTTurSpUu55SmjHTt2XHDBBVH2tv4VqFGjxqGHHpqdnX3//fe/88475557bvRjFy9eHNzhLSsrq0ePHsUevnnz5vnz5+/59Yif6UW/afAnMVz8YxgJSkpfgli77bbb/vGPf5TiwDvuuGPu3LkJz5OWlpaRkdG9e/clS5Y89NBD+++/fzIuQbE2bdoUcWT16tWTmqSkSj2lU+6WW24pemvpkSNHRt+lOrUGDhz43HPPpTpFgu3Z53+0YcOGd955Z/LkyZdccklJ/zo8/PDDwa937949ymuXZs+evXPnzj2/vnTp0nXr1hV7+Omnn16K/eJiuPjHMBKUSMVY2eE3aOvWrRdffHHRexkXobCw8NJLL03eFmTp6el9+vRZvnz5f/zHfyTpEhShoKAg+HPYnqI/aZ1sZZzSKbdy5cqid85o2rTphRdeWG55ymLo0KFuZCrWe++999N7k34hyoYNaf++M97PFRYWzpgxo9jDMzIySjGjYrj4xzASlIi+BLGze/fuSZMmtWzZ8sknnyzLebZu3dq9e/fx48cX/UvxsqhXr94zzzxzwgknJOn8FCHKRsZpxb1ts3wkakqn3K233lr0kxjDhg2rUqVKueUptcMOOywnJyepz7ZVdAUFBYMGDSooKNjzWwcddFDbtm2LPcPXX39dxG7aybslLy2Wi38MI0F0+hLEyPr168eMGdOiRYsrrrjiiy++KPsJd+3aNWTIkDPPPPONN94o+9mCqlatOm3atIYNGybp/ARlZmbus88+UUbm5uYmO0wREj6lU+ujjz565JFHihhw8MEHX3bZZeWWpywOOeSQnJwc+4ztzejRo5cuXRr8Vr9+/aLcePnkk0/u3r17b9994403Pvzww2JPcuSRR5auAMRw8Y9hJIhIX4IYqVy5cq1atSJ+bhDd0qVLTz311F69ekV/dWCJ1K1b97777kvGmdmbAw44IOLIbdu2JTVJ0ZI0pVPo9ttvL/o/6eDBg2vWrFluecri97///bPPPtu4ceNUB4mdRx999Pbbb9/bd6O8diktwidIEV+MVrqPmH4Uw8U/hpGgWPoSxMiBBx542WWXvfHGG8OHD69UKcGvk543b16XLl2OOeaYESNGLF++PHifSal17tz5+OOPT+AJKVr0h082bNiQ1CRFS+qUTomNGzeOHz++iAG1a9euQLulN2zYMCcn54gjjkh1kLgoLCy86667Bg4cuLcBJ510UpSG+fnnn7/yyitFj9nb002/0LNnzzLe5BnDxT+GkaAI+hKpcdxxx1Uvg44dO6b6T5BEmZmZgwcPfuKJJ7KyshJ+8o8//njMmDEdOnQ4+OCDe/fuPXbs2Jdeemn79u1lP/NVV11V9pMQUfPmzSOO/PTTT5OaJIqkTunyN3bs2OAe0z8ZNGhQArdxT7Z69erl5OQcddRRqQ6Sel988UXPnj2L3ggx4qc906dPL/ZBnQ8++CDKxvq1atUq0R7oexPDxT+GkSBIX4KY6tSp06RJkzIzM5N0/u+++27u3Lk333xzp06d6tevf/LJJ1999dVTpkz55JNPSnfC008/vaJspvwrcOKJJ0Yc+fHHHyc1SXTJntLlZsuWLWPGjCliQPXq1W+44YZyyxMU/Q1daWlpBx54YE5OTrNmzZKXJ+a+/fbb2267rUWLFs8++2wRw6pVq3b++edHOWHEz46SuuvD3sRw8Y9hJPg5kwni6+yzzx4+fHg5XCg/P//NN9/85z//edlllzVr1uyII44YNGjQggULSnSPxH777XfcccclLyQ/yczM7Ny5c8TBK1asSGqYEim3KZ1sDz74YNGF5NJLL03tVgp9+/Yt0f/1derUefbZZ39rf4V37tyZk5Pz5z//+Ygjjhg9enSxD/t17do1ysNpa9asWbVqVZQAER9hOuOMM+rVqxdlZEnFcPGPYSTQlyBZfn7PYe3atRs1anTuueeOGzfu66+/jn6Sa665JsrGtYm1fv36CRMmdO/evXnz5iXaAPqYY45JXip+0q1bt+hvZly2bFmirltxp3TC7dy5c9SoUUUMqFy58rBhw8otz55++OGHc88999VXX41+yP777z9v3rwWLVokLVTKFBQU5Obmfvfdd2vWrFmyZMmkSZNuuumms846q0GDBj169Jg8eXLEbSQjvnapSZMmwTfn7umdd96JcsLMzMzyebVXDBf/GEbiN0hfgvKwY8eOr7766oUXXrjpppuOOeaYCRMmRDwwIyPjvvvui7hzdMJ99NFHF1988X//939HHO/16uUgPT09+nYCa9asWb9+fTJiVNApnUBTp0599913ixjQq1ev1P6Ge/PmzV27dn355ZejH7LffvvNmzevdevWyUuVPEU8FluzZs06deocdNBBLVq0OOuss6644opx48YtWbJkx44d0c/fsGHDDh06JC1+MRJ7S16xYrj4xzASvx36EpS3rVu3Dho0qOjnH36uSZMmRWzWVA5GjRoV8RmYOnXqJDsMffr0if7j7MyZM5Ma5kcVbkonREFBQdH3Fqanp998883llido69at2dnZS5YsiX7Ivvvu+/TTT7dp0yZ5qSqoPn36pPCRmKOPPrpVq1blfNEYLv4xjMRvgb4EqTFixIjZs2dHHHzdddfVqlUrmXGKkp+fX/Qz0D8p46a3FOvwww+/++67o4+P+NB5QlSgKZ0o8+bN29srTX8Ufdv35Nm2bVuPHj0WLlwY/ZCaNWvOmTPn5JNPTlqoCqmcP+GJQ4AYLv4xjMRvgb4EKTNo0KCID37su+++1157bbLzFGHjxo1RhpXo5hZKql69erNnz47+LtR//etf7733XlIj/UIFmtKJktqHlCLavn17z549n3/++eiH1KhRY9asWb+CJ80SpU2bNk2aNEltht69e5f/jawxXPxjGIlfPX0JUuabb74ZOXJkxMGXX355xDe69OzZc9y4cYcddlgZov1SxEt/++23CbwoP3fMMce88MILJdpybezYscnLE5SkKR1nS5cunTdvXqpTFC83N7dXr145OTnRD6levfqTTz7Zvn375KWqQFL+4VJaWtp+++3XpUuXIgbEcPGPYSQoBX0JUmnixIlFPzL+k6ysrOuuuy7KyKpVqw4YMODNN9+cPHlyQn7WyczMjPi2xBK98oWIqlWrNnjw4MWLFx988MHRj8rJyfnXv/6VvFR7k4wpHXPDhw8v0U7HqbJz584LL7xw7ty50Q/JysqaMWPGGWeckbxUFULVqlUjvnYp2YqubTFc/GMYCUpBX4JUKigoKHpX4p8bMGBAw4YNIw7OzMzMzs6eN2/eypUrhwwZcuihh5YyYlraf/3Xf0V8DKOc7/761WvQoMF111339ttvDx8+vET34u/YseP6669PXrAiJG9Kx9a77747derUVKeIZNeuXf369Yv+mFlaWlq1atWeeOKJTp06JS9V/HXt2nXfffdNdYq0tLS0M888s9hPV2K4+McwEpSIvgQpNmfOnDfeeCPKyCpVqgwZMqSk52/SpMktt9zyzjvvvPjii0OHDj3hhBMqVaoU8dgGDRo88sgjV155ZZTBmzdv/uCDD0oajx9lZmZWr169YcOGrVu3vvDCC2+//faXXnpp9erVI0eOLMV7Kq+//vq1a9cmI2cUyZ7SMTRq1KidO3emOkUkeXl5/fv3nzFjRvRDqlSpMm3atKLvBPt1i8PNeD+qVKlS9BcxxXDxj2EkiCLqNAWSZ9SoURFfw9e/f/+77777k08+KcVVWrZs2bJly5tuumn79u2vvfbaqlWr3n333Y8//vjLL7/8+uuvc3Nz8/LyqlWrVrNmzcMOO6xZs2YdO3bs3Llz9MeLc3JyKsRdSTGxatWqJJ156tSp0d+GlCTlM6Xj4/PPP3/wwQcHDRqU6iCR5Ofn//GPf8zPz7/gggsiHrLPPvtMmTLl4osvfuqpp5KaLYbq169/2mmnpTrF/3fRRRfde++9JTokhot/DCNBEfQlSL2cnJxly5ZFeeFJ5cqVb7zxxr/85S9luVxWVla7du3atWtXlpPsqTy3rmZvnnvuub/+9a+pTlHeUzoO/v73v19yySXRdy9Mrd27dw8YMCA/P79fv34RD6lcufJjjz12ySWXlM9LveKjT58+mZmZxQ4rLCw8+uijy/LMTO/evR955JFihzVr1qxFixYrV64sxSViuPjHMBLsyf14EAu33nprxJF9+vRJ+ba2e1q9enXEd2KQPAsXLuzTp8+uXbtSHSQtreJP6ZL69ttvy39DwrIoKCi4/PLLJ06cGP2QSpUqPfroo7169UpeqhiKeDPeokWLyrjBwFNPPbV169YERiofMVz8YxiJik5fglhYuHDhkiVLoozMzMwcOnRosvOU1LBhw9z8kFoTJ07Mzs7Ozc1NdZD/q6JP6VIYP378hg0bUp2iBAoKCv72t789/PDD0Q+pVKnSww8/HP1GvoqudevWRx55ZJSRjz32WBmvlZubG/Gzu969e1euXLmMl0uUGC7+MYxERacvQVxE/338+eef37Rp06SGKZFp06Y9/fTTqU7x25Wbmzt48OC//vWveXl5qc7ybyrulC6dbdu23XHHHalOUTKFhYVXXXXVAw88EP2QzMzMhx56KFYfcSRPxD/m1q1b58yZU/bLTZ48Ocqw2rVrn3322WW/XNnFcPGPYSR+BfQliIuXX355wYIFUUZmZGQMGzYs2XkievXVV//2t7+lOsVv14svvnjiiSfef//9qQ4SUEGndFk88sgjH330UapTlExhYeG11147fvz46IdkZGQ88MADl1xySdJCxUKVKlUi3nw4a9asbdu2lf2KL7744meffRZlZBz6agwX/xhG4tdBX4IYif77+G7durVs2TKpYaJYtGhR165d43MP2G/K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`;

module.exports = async function handler(req, res) {
  const steps = [];

  try {
    const apiKey = (process.env.PASSKIT_API_KEY || '').trim();
    const apiSecret = (process.env.PASSKIT_API_KEY_SECRET || '').trim();
    const programId = process.env.PASSKIT_PROGRAM_ID;
    const tierId = process.env.PASSKIT_TIER_ID;
    let host = process.env.PASSKIT_HOST || 'api.pub2.passkit.io';
    if (!host.startsWith('http')) host = 'https://' + host;
    host = host.replace(/\/$/, '');

    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign(
      { uid: apiKey, iat: now, exp: now + 3600 },
      apiSecret,
      { algorithm: 'HS256', header: { alg: 'HS256', typ: 'JWT' } }
    );

    steps.push({
      step: 'config',
      host,
      programId: programId || 'MISSING',
      tierId: tierId || 'MISSING',
    });

    // === Step 1: 画像アップロード — POST /images（複数形！） ===
    let imageId = null;
    try {
      const uploadBody = {
        name: 'VUELTA FIRST DRINK PASS strip',
        imageData: {
          strip: STRIP_IMAGE_BASE64,
        },
      };

      const resp = await fetch(`${host}/images`, {
        method: 'POST',
        headers: {
          'Authorization': token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(uploadBody),
      });
      const text = await resp.text();
      steps.push({
        step: 'upload_image',
        url: `${host}/images`,
        status: resp.status,
        ok: resp.ok,
        body: text.substring(0, 1000),
      });

      if (resp.ok) {
        try {
          const data = JSON.parse(text);
          // PassKit /images returns: { strip: "imageId", icon: "", ... }
          imageId = data.strip || data.id || data.Id || data.imageId || data.ID;
          steps.push({ step: 'image_id_found', imageId });
        } catch (e) {
          // テキストがそのままIDの可能性
          if (text && text.length < 100 && !text.includes('{')) {
            imageId = text.trim().replace(/"/g, '');
            steps.push({ step: 'image_id_from_text', imageId });
          }
        }
      }
    } catch (err) {
      steps.push({ step: 'upload_image_error', message: err.message });
    }

    // === Step 2: tier情報を取得（現在のimageIds確認） ===
    let tierData = null;
    try {
      const tierResp = await fetch(`${host}/members/tier/${programId}/${tierId}`, {
        headers: { 'Authorization': token },
      });
      const tierText = await tierResp.text();
      steps.push({
        step: 'get_tier',
        status: tierResp.status,
        body: tierText.substring(0, 2000),
      });
      if (tierResp.ok) {
        tierData = JSON.parse(tierText);
      }
    } catch (err) {
      steps.push({ step: 'get_tier_error', message: err.message });
    }

    // === Step 3: imageId取得済みなら、tier・template・programを更新 ===
    if (imageId) {
      const existingImageIds = tierData?.imageIds || {};
      const updatedImageIds = { ...existingImageIds, strip: imageId };
      const passTemplateId = tierData?.passTemplateId;
      const tierIndex = tierData?.tierIndex || 1;
      let updated = false;

      // 3a: tier PUT（tierIndex必須）
      try {
        const resp = await fetch(`${host}/members/tier`, {
          method: 'PUT',
          headers: { 'Authorization': token, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: tierId,
            programId: programId,
            tierIndex: tierIndex,
            imageIds: updatedImageIds,
          }),
        });
        const text = await resp.text();
        steps.push({ step: 'update_tier_put', status: resp.status, ok: resp.ok, body: text.substring(0, 1000) });
        if (resp.ok) { updated = true; steps.push({ step: 'TIER_STRIP_SET', imageId }); }
      } catch (err) {
        steps.push({ step: 'update_tier_put_error', message: err.message });
      }

      // 3b: passTemplate更新（画像をテンプレートレベルで設定）
      if (passTemplateId) {
        try {
          const resp = await fetch(`${host}/template`, {
            method: 'PUT',
            headers: { 'Authorization': token, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: passTemplateId,
              imageIds: updatedImageIds,
            }),
          });
          const text = await resp.text();
          steps.push({ step: 'update_template', status: resp.status, ok: resp.ok, body: text.substring(0, 500) });
          if (resp.ok) { updated = true; steps.push({ step: 'TEMPLATE_STRIP_SET', imageId }); }
        } catch (err) {
          steps.push({ step: 'update_template_error', message: err.message });
        }
      }

      // 3c: program更新
      try {
        const resp = await fetch(`${host}/members/program`, {
          method: 'PUT',
          headers: { 'Authorization': token, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: programId,
            imageIds: updatedImageIds,
          }),
        });
        const text = await resp.text();
        steps.push({ step: 'update_program', status: resp.status, ok: resp.ok, body: text.substring(0, 500) });
        if (resp.ok) { updated = true; steps.push({ step: 'PROGRAM_STRIP_SET', imageId }); }
      } catch (err) {
        steps.push({ step: 'update_program_error', message: err.message });
      }

      if (!updated) {
        steps.push({ step: 'WARNING', message: 'No update succeeded. Strip image uploaded but not linked to tier/template/program.' });
      }
    } else {
      steps.push({ step: 'SKIP_UPDATES', reason: 'imageId not obtained from upload' });
    }

    // === Step 4: 最終確認 — program情報のimageIds ===
    try {
      const progResp = await fetch(`${host}/members/program/${programId}`, {
        headers: { 'Authorization': token },
      });
      if (progResp.ok) {
        const prog = JSON.parse(await progResp.text());
        steps.push({
          step: 'program_image_check',
          imageIds: prog.imageIds || 'none',
        });
      }
    } catch (err) {
      steps.push({ step: 'program_check_error', message: err.message });
    }

  } catch (err) {
    steps.push({ step: 'fatal_error', message: err.message, stack: err.stack?.substring(0, 300) });
  }

  res.json({ endpoint: 'setup-strip-image', timestamp: new Date().toISOString(), imageIdObtained: !!steps.find(s => s.imageId), steps });
};
