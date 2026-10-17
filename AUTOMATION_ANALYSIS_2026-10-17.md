# AI Image Automations — Analysis (Gemini · ChatGPT · Flow) — 17 Oct 2026

Sirf parha, **koi code nahi badla**. Live Gemini / ChatGPT / Flow par test nahi hua.

Files: `sidepanel.js` (runner: stepper + "pool"), `gemini_automation.js`, `gpt_automation.js`, `flow_automation.js`.

---

## 1. Abhi kaam kaise hota hai

| | Gemini | ChatGPT | Flow |
|---|---|---|---|
| Runner | "Pool": 1–3 tabs ek saath (`gptPoolStart`) | "Pool": 1–4 tabs ek saath | "Stepper": ek waqt mein 1 image |
| Image bhejna | Hidden file input → paste → drop (3 tareeqe, 3 retry) | Sirf drag-drop | Paste → drop → upload + "Add to prompt" |
| Send | Script Send dabata hai | Script Send dabata hai, warna aap | **Chrome debugger (CDP) click**, ya setting OFF ho to aap |
| Result pakarna | Aap ke message ke baad wali sab se bari image (≥400px), 1 sec stable | Naya "generated image" ya answer ki bari image | Naya tile jis par "Reuse prompt" ho |
| Wapas panel tak | Message ka jawab (har ~9s poll) | `chrome.storage` key (`zhGptRes_<id>`) | Message + storage watchdog (har 2.5s) |
| Chat | Har 5 images (ya prompt ka "every") ke baad nayi chat | Wahi | Ek project; "unusual activity" par naya project (max 2) |
| Limit | Agla Google account `/u/N` (6 tak) | Limit = poora ChatGPT band | Safe speed + naya project |
| Rafter | 3–9s gap har image ke baad | 3–9s | Safe 8–20s / Normal 4–10s / Fast 1.5–4s + breaks |
| Timeout | Attach 120s, image 9 min | 9 min | Attach 60s, start 20s, result 3 min |

Result aane ke baad (sab engines): pack label stamp → bari PNG ko JPEG → Library mein save → background mein **freeimage.host** par public link.

---

## 2. Bugs / kamzoriyan (severity ke hisaab se)

### 🔴 Bare
1. **Gemini run ke aakhir mein window khud band ho jati hai aur hamesha "All selected images processed successfully!" kehti hai** — chahe kuch images fail hui hon. Failed images aur "Retry failed" button nazar hi nahi aate. (`temuStepFinish`, sidepanel.js ~18132–18149)
2. **Do alag Gemini code paths.** "Gemini" engine pool wala (`gemRunOnTab`) use karta hai jis mein limit → account switch, CAPTCHA check, "error" par 3 retry, background tab ko jagana sab hai. Lekin **"Auto" engine** ka Gemini step purana code use karta hai: koi limit/CAPTCHA/retry/jagana nahi, image `fetch()` se seedha (Amazon jaisi CDN par fail ho sakti hai → image attach nahi hoti), chat kabhi nayi nahi hoti (chat lambi hoti jati hai → slow + purani images ka asar). (~17958–18009)
3. **Har image par focus chheena jata hai.** Pool har bhejne par ChatGPT/Gemini tab ko `active: true` karta hai, aur Gemini "peek" har 30s tab saamne lata hai. 2–3 tabs ke saath aap ka kaam baar baar beech mein ruk jata hai. Flow bhi har job par apna tab saamne laata hai.
4. **Flow hardcoded "Nano Banana 2 · 1:1 · x1".** Google ne model ka naam badla ya menu badla to har job "Flow settings were not applied" par fail hogi.
5. **ChatGPT limit = poora run band** (`gptDown`); baqi images na Flow/Gemini par jati hain na ruk kar baad mein — sirf "Auto" engine fallback karta hai.

### 🟠 Darmiyane
6. **"Paste & Next" (Gemini wala purana rasta)** image lagata hai lekin edit-journal mein record nahi karta, stats nahi badalta, pack/stage handle nahi karta (~18101–18119). Reload ke baad woh edit "Continue" list mein phir aa sakta hai.
7. **Har edited image public internet par** (freeimage.host, fixed demo API key). Host busy/down ho to export rukta hai; images public hoti hain. Har image ek se zyada dafa upload ho sakti hai (stepper + export dono).
8. **Flow job poori image (base64, kai MB) `chrome.storage` mein** likhta hai har image par — bara write, storage mein kachra.
9. **ChatGPT attach sirf drag-drop**; ChatGPT ne drop band kiya to attach fail (thumbnail check sirf log karta hai, aage chal deta hai → bina image ke prompt chala jata hai, galat image ban sakti hai).
10. **ChatGPT reused tab = aap ki apni chat.** Agar ChatGPT tab pehle se khula ho to run usi chat mein shuru hota hai (aap ki baat cheet ke beech).
11. **Gemini account rotation** tab ko `/u/0…/u/6` par ghumata hai — sign-in page par jaa sakta hai, aap ka account badal jata hai bina poochhe.
12. **Result pehchaan size-based** (Gemini ≥400px, ChatGPT ≥300px): agar model text + chhoti image de ya aap ki upload preview bari dikhe to ghalat image utha sakta hai (Gemini mein position check hai, ChatGPT mein `seenSrc` — kaafi had tak bachao hai).
13. **"Setup once per chat" prompts**: baad ki images sirf "New product image." ke saath jati hain — model pehla rule bhool sakta hai (count text ka masla pehle aa chuka hai; har 5 image par poora prompt).

### 🟡 Chhote
14. Gemini/ChatGPT HUD, Flow HUD alag alag style; Flow HUD "ok" ke ilawa gayab nahi hota.
15. ChatGPT archive feature OFF hai lekin code baqi hai.
16. Timeouts lambe (9 min) — atki hui image poora tab 9 min rok leti hai.
17. Koi daily counter nahi (kitni images aaj kis account par) — limit se pehle warning nahi.

---

## 3. Behtari ke ideas (aap chunein)

**A. Reliability (sab se pehle)**
- Ek hi Gemini engine (pool wala) Auto mein bhi; Gemini finish par sahi summary + failed list + Retry.
- ChatGPT attach: file-input (+ button) pehle, drop fallback; attach confirm na ho to **send na karo**.
- Flow: model/ratio settings "best effort" — model na mile to jo selected hai use karo aur warning do (fail na karo); settings ka naam config mein.
- Har engine ke liye "limit" par: ruk jao + timer ("X min baad dobara"), ya baqi images doosre engine par (aap ki marzi).

**B. Speed**
- Focus kam chheenna: tab sirf tab saamne laana jab zaroori ho (Gemini atka ho), warna background mein; ya alag Chrome window mein AI tabs (minimized nahi, peeche).
- Gaps chhote "Fast" mode (abhi pool ka gap fixed 3–9s).
- Pehle se agle 2 images download (abhi sirf 1).
- Timeout 9 min → 4 min + ek auto retry.

**C. Quality / control**
- Har image ke baad "Before / After" chhota preview + 👍/👎 (👎 = redo same engine/nayi chat).
- Prompt rules har image ke saath chhote roop mein (sirf "New product image" nahi).
- Daily counter per engine/account + limit se pehle warning.

**D. Privacy / storage**
- Public host sirf export ke waqt (pehle nahi); ya apna Google Drive / ImgBB key option.
- Flow job ki image storage mein na rakhna (message se bhejna).

---

## 4. Faisla aap ka
Aap batayein: **sab se zyada kya chubhta hai** — fail hona, slow hona, focus chheenna, quality, ya limits? Aur aap zyada tar **kaunsa engine** chalate hain? Us ke hisaab se plan banaunga.
