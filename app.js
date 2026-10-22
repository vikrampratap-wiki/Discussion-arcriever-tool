/**
 * हिन्दी विकिपीडिया चर्चा समापन एवं पुरालेखण टूल (Frontend Application Logic)
 * लेखक: सदस्य:विक्रम प्रताप
 * अनुकूलित: hi.wikipedia.org
 * 
 * विशेषताएँ:
 * - विकिमेडिया लॉगिन एवं बॉट टोकन प्रमाणीकरण
 * - न्यूनतम पात्रता सुरक्षा जाँच: स्वतः स्थापित सदस्य (Autoconfirmed) अनिवार्य
 * - स्वचालित बॉट मोड (Auto-Archiver Bot Throttling)
 * - सीधे विकिपीडिया पर सहेजने की सुविधा (Direct Save & Form Submit)
 * - एकल ऑफ़लाइन फ़ाइल बंडल डाउनलोडर (All-in-One Standalone)
 */

(function () {
    'use strict';

    // =========================================================================
    // 1. स्थिरांक एवं विन्यास (Constants & Mappings)
    // =========================================================================

    const WIKI_API = 'https://hi.wikipedia.org/w/api.php';

    const DEVANAGARI_DIGITS = {
        '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
        '५': '5', '६': '6', '७': '7', '८': '8', '९': '9'
    };

    const HINDI_MONTH_MAP = {
        'जनवरी': 0, 'फ़रवरी': 1, 'फरवरी': 1, 'मार्च': 2, 'अप्रैल': 3, 'मई': 4, 'जून': 5,
        'जुलाई': 6, 'अगस्त': 7, 'सितम्बर': 8, 'सितंबर': 8, 'अक्टूबर': 9, 'अक्तूबर': 9,
        'नवम्बर': 10, 'नवंबर': 10, 'दिसम्बर': 11, 'दिसंबर': 11,
        'january': 0, 'february': 1, 'march': 2, 'april': 3, 'may': 4, 'june': 5,
        'july': 6, 'august': 7, 'september': 8, 'october': 9, 'november': 10, 'december': 11,
        'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'jun': 5,
        'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
    };

    // वैश्विक स्थिति (State)
    const state = {
        currentPageTitle: '',
        currentBaseTimestamp: '',
        currentWikitext: '',
        parsedData: null,
        existingArchives: [],
        suggestedArchiveTitle: '',
        latestArchiveSizeKB: 0,
        selectedIndices: new Set(),
        theme: localStorage.getItem('da_theme') || 'light',
        activePreviewPayload: null,
        auth: {
            username: localStorage.getItem('da_wiki_user') || localStorage.getItem('da_username') || '',
            isLoggedIn: false,
            isAutoconfirmed: false,
            isBot: false,
            isSysop: false,
            editCount: 0,
            daysOld: 0,
            groups: [],
            verified: false,
            central: null
        },
        botRunner: {
            isRunning: false,
            timer: null,
            delayMs: 5000,
            processedCount: 0
        }
    };

    // =========================================================================
    // 2. सहायक फ़ंक्शन (Utility Functions)
    // =========================================================================

    function normalizeDevanagariDigits(str) {
        if (!str) return '';
        let out = '';
        for (let i = 0; i < str.length; i++) {
            const ch = str[i];
            out += DEVANAGARI_DIGITS[ch] !== undefined ? DEVANAGARI_DIGITS[ch] : ch;
        }
        return out;
    }

    function sanitizeSectionAnchor(title) {
        if (!title) return '';
        return title
            .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
            .replace(/'''?/g, '')
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function formatBytes(bytes) {
        const kb = bytes / 1024;
        if (kb < 1024) return kb.toFixed(1) + ' KB';
        return (kb / 1024).toFixed(2) + ' MB';
    }

    function escapeHtml(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function logMessage(msg, type = 'info') {
        const logBody = document.getElementById('activity-log');
        if (!logBody) return;
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        const timeStr = new Date().toLocaleTimeString('hi-IN', { hour12: false });
        entry.innerHTML = `<span style="color:var(--text-muted);">[${timeStr}]</span> ${msg}`;
        logBody.appendChild(entry);
        logBody.scrollTop = logBody.scrollHeight;
    }

    // =========================================================================
    // 3. विकिटेक्स्ट एवं गतिविधि विश्लेषक (Discussion Parser)
    // =========================================================================

    function getIgnoredRanges(wikitext) {
        const pattern = /<!--[\s\S]*?-->|<nowiki>[\s\S]*?<\/nowiki>|<pre>[\s\S]*?<\/pre>|<syntaxhighlight[\s\S]*?<\/syntaxhighlight>/gi;
        const ranges = [];
        let m;
        while ((m = pattern.exec(wikitext)) !== null) {
            ranges.push({ start: m.index, end: m.index + m[0].length });
        }
        return ranges;
    }

    function isIndexIgnored(idx, ranges) {
        for (let i = 0; i < ranges.length; i++) {
            if (idx >= ranges[i].start && idx < ranges[i].end) return true;
        }
        return false;
    }

    function analyzeSectionActivity(bodyText) {
        const cleanTrim = (bodyText || '').replace(/<!--[\s\S]*?-->/g, '').trim();
        if (!cleanTrim) {
            return { lastDateStr: 'रिक्त अनुभाग', daysInactive: 99999, commentCount: 0, uniqueUsers: 0, isEmpty: true };
        }

        const normalized = normalizeDevanagariDigits(cleanTrim);

        // टिप्पणियों एवं समय-मोहरों की गणना
        const timeMatches = normalized.match(/(\d{1,2}:\d{2}(?::\d{2})?|\b\d{4}-\d{2}-\d{2}\b)/g) || [];

        // प्रतिभागी सदस्यों की पहचान
        const userMatches = normalized.match(/\[\[\s*(?:सदस्य|User|सदस्य[ _]वार्ता|User[ _]talk)\s*:([^\]|]+)/gi) || [];
        const uniqueUsers = new Set();
        userMatches.forEach(u => {
            const raw = u.replace(/^\[\[\s*(?:सदस्य|User|सदस्य[ _]वार्ता|User[ _]talk)\s*:/i, '').trim().toLowerCase();
            if (raw) uniqueUsers.add(raw);
        });

        const commentCount = timeMatches.length > 0 ? timeMatches.length : (uniqueUsers.size > 0 ? uniqueUsers.size : (userMatches.length > 0 ? 1 : 0));

        // नवीनतम गतिविधि दिनांक विश्लेषण
        const datePattern = /(\d{1,2})\s+([^\s\d,()]{3,12})\s+(\d{4})/g;
        const isoPattern = /\b(\d{4})-(\d{2})-(\d{2})\b/g;
        let maxEpoch = 0;
        let latestDateLabel = 'अज्ञात';
        const nowEpoch = Date.now();
        let m;

        while ((m = datePattern.exec(normalized)) !== null) {
            const day = parseInt(m[1], 10);
            const monthKey = m[2].toLowerCase().replace(/[.,]/g, '');
            const year = parseInt(m[3], 10);
            const monthIdx = HINDI_MONTH_MAP[monthKey];

            if (monthIdx !== undefined && year >= 2000 && year <= 2035 && day >= 1 && day <= 31) {
                const dt = new Date(year, monthIdx, day).getTime();
                if (dt > maxEpoch && dt <= nowEpoch + 86400000) {
                    maxEpoch = dt;
                    latestDateLabel = `${day} ${m[2]} ${year}`;
                }
            }
        }

        while ((m = isoPattern.exec(normalized)) !== null) {
            const y = parseInt(m[1], 10);
            const mon = parseInt(m[2], 10) - 1;
            const d = parseInt(m[3], 10);
            if (y >= 2000 && y <= 2035 && mon >= 0 && mon <= 11 && d >= 1 && d <= 31) {
                const dt = new Date(y, mon, d).getTime();
                if (dt > maxEpoch && dt <= nowEpoch + 86400000) {
                    maxEpoch = dt;
                    latestDateLabel = `${d}-${mon + 1}-${y}`;
                }
            }
        }

        let daysInactive = -1;
        if (maxEpoch > 0) {
            daysInactive = Math.max(0, Math.floor((nowEpoch - maxEpoch) / (1000 * 60 * 60 * 24)));
        }

        return {
            lastDateStr: latestDateLabel,
            daysInactive: daysInactive,
            commentCount: commentCount,
            uniqueUsers: uniqueUsers.size,
            isEmpty: false
        };
    }

    function isSectionClosed(bodyText) {
        if (!bodyText) return false;
        const closeRegex = /(\{\{\s*(?:चर्चा[_ ]शीर्ष|चर्चा[_ ]तल|चर्चा[_ ]बंद|बंद[_ ]चर्चा|Archive[_ ]top|Archive[_ ]bottom|Atop|Abot|Cot|Cob|Hat|Hab|Discussion[_ ]top|Discussion[_ ]bottom)|class\s*=\s*"[^"]*(?:discussion-archived|boilerplate[^"]*archived))/i;
        return closeRegex.test(bodyText);
    }

    function parseWikitextIntoSections(wikitext) {
        if (!wikitext) return { lead: '', sections: [], hasArchiveBox: false };

        const ignoredRanges = getIgnoredRanges(wikitext);
        const headingRegex = /^[ \t]*==([^=\n][^\n]*?)==[ \t]*(?:<!--[\s\S]*?-->[ \t]*)*$/gm;
        const matches = [];
        let m;

        while ((m = headingRegex.exec(wikitext)) !== null) {
            if (!isIndexIgnored(m.index, ignoredRanges)) {
                matches.push({
                    start: m.index,
                    endOfHeading: m.index + m[0].length,
                    rawHeading: m[0],
                    title: m[1].trim(),
                    cleanTitle: sanitizeSectionAnchor(m[1].trim())
                });
            }
        }

        const boxRegex = /\{\{\s*(?:पुरालेख[_ ]पेटी|पुरालेख|Archives|Archive[_ ]box)/i;

        if (matches.length === 0) {
            return { lead: wikitext, sections: [], hasArchiveBox: boxRegex.test(wikitext) };
        }

        const leadText = wikitext.substring(0, matches[0].start);
        const sections = [];

        for (let i = 0; i < matches.length; i++) {
            const cur = matches[i];
            const nextStart = (i + 1 < matches.length) ? matches[i + 1].start : wikitext.length;
            const fullText = wikitext.substring(cur.start, nextStart);
            const bodyText = wikitext.substring(cur.endOfHeading, nextStart);
            const activity = analyzeSectionActivity(bodyText);

            sections.push({
                index: i + 1,
                title: cur.title,
                cleanTitle: cur.cleanTitle,
                rawHeading: cur.rawHeading,
                bodyText: bodyText,
                fullText: fullText,
                sizeBytes: new Blob([fullText]).size,
                isClosed: isSectionClosed(bodyText),
                isEmpty: activity.isEmpty,
                lastDateStr: activity.lastDateStr,
                daysInactive: activity.daysInactive,
                commentCount: activity.commentCount,
                uniqueUsers: activity.uniqueUsers
            });
        }

        return {
            lead: leadText,
            sections: sections,
            hasArchiveBox: boxRegex.test(leadText)
        };
    }

    function buildClosedSectionWikitext(sectionObj, statusLabel, badgeTpl, verdictText, formatType) {
        const cleanBody = sectionObj.bodyText.replace(/^\r?\n/, '').replace(/\s+$/, '');
        const badgeStr = badgeTpl ? `{{${badgeTpl}}} ` : '';
        const verdictBody = verdictText ? `${verdictText.trim()} --~~~~` : '--~~~~';
        const fullVerdictLine = `${badgeStr}'''${statusLabel}:''' ${verdictBody}`;

        let wrapped = '';
        if (formatType === 'charcha_tpl_param') {
            wrapped = `\n{{चर्चा शीर्ष|1=${fullVerdictLine}}}\n\n${cleanBody}\n\n{{चर्चा तल}}\n\n`;
        } else if (formatType === 'charcha_tpl') {
            wrapped = `\n{{चर्चा शीर्ष}}\n:${fullVerdictLine}\n\n${cleanBody}\n\n{{चर्चा तल}}\n\n`;
        } else if (formatType === 'archive_top_bottom') {
            wrapped = `\n{{Archive top|result=${fullVerdictLine}}}\n\n${cleanBody}\n\n{{Archive bottom}}\n\n`;
        } else if (formatType === 'cot_cob') {
            wrapped = `\n{{cot|शीर्षक=${statusLabel}}}\n:${fullVerdictLine}\n\n${cleanBody}\n\n{{cob}}\n\n`;
        } else if (formatType === 'hat_hab') {
            wrapped = `\n{{Hat|1=${fullVerdictLine}}}\n\n${cleanBody}\n\n{{Hab}}\n\n`;
        }

        return sectionObj.rawHeading + wrapped;
    }

    function reopenClosedSectionWikitext(sectionObj, cleanVerdict) {
        let body = sectionObj.bodyText;
        // 1-2 स्तरों तक नेस्टेड कर्ली ब्रैकेट्स (जैसे {{पूर्ण}}) को भी सुरक्षित रूप से हटाएँ
        const topPattern = /\{\{\s*(?:चर्चा[_ ]शीर्ष|Archive[_ ]top|Atop|Cot|Hat|Discussion[_ ]top)(?:\|(?:\{\{[^{}]*\}\}|[^{}])*?)?\}\}\s*\n?/gi;
        const bottomPattern = /\n?\s*\{\{\s*(?:चर्चा[_ ]तल|Archive[_ ]bottom|Abot|Cob|Hab|Discussion[_ ]bottom)\s*\}\}\s*\n?/gi;
        body = body.replace(topPattern, '');
        body = body.replace(bottomPattern, '');
        body = body.replace(/<div[^>]*class\s*=\s*"[^"]*(?:discussion-archived|boilerplate)[^"]*"[^>]*>\s*\n?/gi, '');
        body = body.replace(/\n?\s*<\/div>\s*/gi, '\n');
        body = body.replace(/^:''निम्नलिखित चर्चा अब समाप्त हो चुकी है। कृपया इसमें कोई परिवर्तन न करें।''\s*\n?/gm, '');

        if (cleanVerdict) {
            body = body.replace(/^:(?:\{\{[^}]+\}\}\s*)?'''(?:परिणाम|निष्कर्ष|स्वीकृत|अस्वीकृत|अस्वीकार|निस्तारित|सहमति|सहमति बनी|सहमति नहीं|हटाया गया|रखा गया|स्थानांतरित|विलय|चर्चा समाप्त|वापस लिया)[^']*''':?.*?(?:--\s*~{3,5}|\d{4}\s*\([A-Z]+\))\s*\n+/im, '');
        }

        return sectionObj.rawHeading + '\n' + body.replace(/^\r?\n/, '');
    }

    // =========================================================================
    // 4. विकिपीडिया Action API इंटरैक्शन एवं पात्रता सत्यापन
    // =========================================================================

    // पुनः प्रयास सहित fetch (Retry-capable fetch wrapper)
    async function fetchWithRetry(url, options = {}, maxRetries = 2) {
        let lastError;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const resp = await fetch(url, options);
                if (!resp.ok) {
                    throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
                }
                return resp;
            } catch (err) {
                lastError = err;
                if (attempt < maxRetries) {
                    const waitMs = 800 * (attempt + 1);
                    logMessage(`नेटवर्क त्रुटि — ${waitMs / 1000}s बाद पुनः प्रयास (${attempt + 1}/${maxRetries})...`, 'warning');
                    await new Promise(r => setTimeout(r, waitMs));
                }
            }
        }
        throw new Error(`नेटवर्क त्रुटि: विकिमीडिया सर्वर से संपर्क नहीं हो सका। कृपया अपना इंटरनेट कनेक्शन जाँचें। (${lastError ? lastError.message : 'Unknown error'})`);
    }

    async function fetchWikipediaAPI(params) {
        params.format = 'json';
        params.origin = '*'; // CORS support

        const queryStr = Object.keys(params)
            .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
            .join('&');
        const url = `${WIKI_API}?${queryStr}`;

        const resp = await fetchWithRetry(url);
        return await resp.json();
    }

    // विकिमीडिया सेंट्रलऑथ (CentralAuth SUL) वैश्विक खाता विवरण
    async function fetchCentralAuthInfo(username) {
        if (!username) return null;
        const cleanName = username.trim().replace(/^सदस्य:/i, '').replace(/^User:/i, '');
        const metaUrl = `https://meta.wikimedia.org/w/api.php?action=query&meta=globaluserinfo&guiuser=${encodeURIComponent(cleanName)}&guiprop=groups|rights|merged|editcount&format=json&origin=*`;

        try {
            const resp = await fetchWithRetry(metaUrl, {}, 1);
            const data = await resp.json();
            const gui = data.query && data.query.globaluserinfo ? data.query.globaluserinfo : null;
            if (!gui || gui.missing !== undefined) return null;
            return {
                id: gui.id,
                name: gui.name,
                home: gui.home,
                registration: gui.registration,
                globalEditCount: gui.editcount || 0,
                groups: gui.groups || [],
                mergedCount: gui.merged ? gui.merged.length : 0,
                isUnified: true
            };
        } catch (e) {
            console.warn('CentralAuth fetch error:', e);
            return null;
        }
    }

    // =========================================================================
    // 4.1 विकिमीडिया आधिकारिक OAuth 2.0 PKCE एवं सत्र प्रमाणीकरण
    // =========================================================================

    const DEFAULT_OAUTH_CLIENT_ID = '936e053f19472304dfdf1fbeee44e3cb';

    function getOAuthClientId() {
        return localStorage.getItem('da_oauth_client_id') || DEFAULT_OAUTH_CLIENT_ID;
    }

    function generateRandomString(length = 64) {
        const array = new Uint8Array(length);
        window.crypto.getRandomValues(array);
        return Array.from(array, dec => ('0' + dec.toString(16)).slice(-2)).join('');
    }

    async function sha256(plain) {
        const encoder = new TextEncoder();
        const data = encoder.encode(plain);
        return await window.crypto.subtle.digest('SHA-256', data);
    }

    function base64urlencode(buffer) {
        let str = "";
        const bytes = new Uint8Array(buffer);
        for (let i = 0; i < bytes.byteLength; i++) {
            str += String.fromCharCode(bytes[i]);
        }
        return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    }

    async function generatePKCE() {
        const codeVerifier = generateRandomString(64);
        sessionStorage.setItem('da_oauth_verifier', codeVerifier);
        const hashed = await sha256(codeVerifier);
        return base64urlencode(hashed);
    }

    // विकिमीडिया आधिकारिक OAuth 2.0 लॉगिन प्रारंभ करें
    async function startWikimediaOAuthLogin() {
        let clientId = getOAuthClientId();

        // यदि Client ID डिफ़ॉल्ट/अस्थायी है या खाली है, तो उपयोगकर्ता को सूचित करें
        if (!clientId || clientId === DEFAULT_OAUTH_CLIENT_ID) {
            const entered = prompt(
                'मेटा-विकिमीडिया (Meta-Wiki) पर इस उपकरण का पंजीकृत OAuth 2.0 Consumer Client ID आवश्यक है।\n\n' +
                'यदि आपके पास मेटा-विकी (Special:OAuthConsumerRegistration) से प्राप्त Client ID है, तो यहाँ पेस्ट करें:\n' +
                '(यदि नहीं है तो Cancel करें और विकिपीडिया common.js में DiscussionArchiver.js जोड़कर बिना OAuth के सीधे उपयोग करें)',
                ''
            );
            if (entered && entered.trim()) {
                clientId = entered.trim();
                localStorage.setItem('da_oauth_client_id', clientId);
                const inp = document.getElementById('oauth-client-id-input');
                if (inp) inp.value = clientId;
            } else {
                return;
            }
        }

        const redirectUri = window.location.origin + window.location.pathname;

        try {
            const codeChallenge = await generatePKCE();
            const authUrl = new URL('https://meta.wikimedia.org/w/rest.php/oauth2/authorize');
            authUrl.searchParams.set('client_id', clientId);
            authUrl.searchParams.set('response_type', 'code');
            authUrl.searchParams.set('redirect_uri', redirectUri);
            authUrl.searchParams.set('code_challenge', codeChallenge);
            authUrl.searchParams.set('code_challenge_method', 'S256');

            logMessage('विकिमीडिया आधिकारिक OAuth 2.0 सत्यापन पृष्ठ पर भेजा जा रहा है...', 'info');
            window.location.href = authUrl.toString();
        } catch (e) {
            console.error('OAuth initiation failed:', e);
            alert('OAuth प्रारंभ करने में त्रुटि: ' + e.message);
        }
    }

    // OAuth कॉल-बैक विनिमय (Handle OAuth 2.0 Redirect Callback)
    async function handleOAuthCallback() {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        const oauthError = urlParams.get('error');
        const oauthErrorDesc = urlParams.get('error_description');

        if (oauthError) {
            logMessage(`विकिमीडिया OAuth त्रुटि: ${oauthError} (${oauthErrorDesc || ''})`, 'error');
            alert(`विकिमीडिया लॉगिन अस्वीकृत अथवा त्रुटिपूर्ण: ${oauthErrorDesc || oauthError}`);
            window.history.replaceState({}, document.title, window.location.pathname);
            return false;
        }

        if (code) {
            logMessage('विकिमीडिया ऑथराइजेशन कोड प्राप्त हुआ। टोकन विनिमय हो रहा है...', 'info');
            const clientId = getOAuthClientId();
            const redirectUri = window.location.origin + window.location.pathname;
            const codeVerifier = sessionStorage.getItem('da_oauth_verifier');

            window.history.replaceState({}, document.title, window.location.pathname);

            const tokenUrl = 'https://meta.wikimedia.org/w/rest.php/oauth2/access_token';
            const bodyParams = new URLSearchParams({
                client_id: clientId,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: redirectUri,
                code_verifier: codeVerifier || ''
            });

            try {
                const resp = await fetch(tokenUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: bodyParams
                });

                const tokenData = await resp.json();
                if (tokenData.access_token) {
                    sessionStorage.setItem('da_oauth_token', tokenData.access_token);
                    const profileResp = await fetch('https://meta.wikimedia.org/w/rest.php/oauth2/resource/profile', {
                        headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
                    });
                    const profileData = await profileResp.json();
                    if (profileData && profileData.username) {
                        const uName = profileData.username;
                        const res = await checkUserEligibility(uName);
                        if (res && res.exists && res.isAutoconfirmed) {
                            state.auth = Object.assign(state.auth, res, { isLoggedIn: true, verified: true });
                            localStorage.setItem('da_wiki_user', res.username);
                            localStorage.setItem('da_username', res.username);
                            updateAccessControlUI(state.auth);
                            logMessage(`विकिमीडिया OAuth लॉगिन सफल: <b>${escapeHtml(res.username)}</b>। उपकरण अनलॉक हो गया है!`, 'success');
                            return true;
                        }
                    }
                } else {
                    logMessage(`OAuth टोकन विनिमय विफल: ${JSON.stringify(tokenData)}`, 'warning');
                }
            } catch (e) {
                console.error('OAuth token exchange error:', e);
                logMessage(`OAuth नेटवर्क त्रुटि: ${e.message}`, 'error');
            }
        }
        return false;
    }

    // पोस्ट-मेसेज श्रोता (PostMessage Listener for Wiki Auth Bridge)
    window.addEventListener('message', async (e) => {
        if (e.data && e.data.type === 'WIKI_AUTH_SUCCESS' && e.data.username) {
            const uName = e.data.username;
            const res = await checkUserEligibility(uName);
            if (res && res.exists && res.isAutoconfirmed) {
                state.auth = Object.assign(state.auth, res, { isLoggedIn: true, verified: true });
                localStorage.setItem('da_wiki_user', res.username);
                localStorage.setItem('da_username', res.username);
                updateAccessControlUI(state.auth);
                const modal = document.getElementById('login-modal');
                if (modal) modal.style.display = 'none';
                logMessage(`विकिपीडिया सत्र पहचाना गया: <b>${escapeHtml(res.username)}</b>। उपकरण अनलॉक हो गया है!`, 'success');
                loadPage((new URLSearchParams(window.location.search)).get('page') || 'विकिपीडिया:चौपाल');
            }
        }
    });

    // सत्यापन कार्ड रेंडर (Verification Profile Card)
    function renderVerificationCard(res, resBox) {
        if (!resBox) resBox = document.getElementById('verification-result-box');
        if (!resBox) return;

        const autoconfirmedTag = res.isAutoconfirmed
            ? '<span class="badge-autoconfirmed">✅ स्वतः स्थापित (पात्र)</span>'
            : '<span class="badge-restricted">⚠️ अपात्र (न्यूनतम 4 दिन पुराना + 10 संपादन आवश्यक)</span>';
        const contribLink = 'https://hi.wikipedia.org/wiki/Special:Contributions/' + encodeURIComponent(res.username);

        resBox.style.display = 'block';
        resBox.innerHTML = `
            <div class="central-auth-card">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; flex-wrap:wrap; gap:8px;">
                    <div style="display:flex; align-items:center; gap:8px;">
                        <span class="user-avatar" style="width:32px; height:32px; font-size:14px;">${escapeHtml((res.username[0] || 'व').toUpperCase())}</span>
                        <div>
                            <strong style="font-size:15px;">${escapeHtml(res.username)}</strong>
                            <span class="badge-autoconfirmed" style="margin-left:5px;">✓ विकिपीडिया सदस्य</span>
                        </div>
                    </div>
                    ${autoconfirmedTag}
                </div>
                <div class="metric-grid">
                    <div class="metric-box">
                        <div class="metric-val">${res.editCount.toLocaleString('hi-IN')}</div>
                        <div class="metric-lbl">🇮🇳 संपादन संख्या</div>
                    </div>
                    <div class="metric-box">
                        <div class="metric-val">${res.daysOld.toLocaleString('hi-IN')} दिन</div>
                        <div class="metric-lbl">📅 खाता आयु</div>
                    </div>
                    <div class="metric-box">
                        <div class="metric-val">${res.isSysop ? 'प्रबंधक' : (res.isBot ? 'बॉट' : 'सदस्य')}</div>
                        <div class="metric-lbl">🛡️ अधिकार स्थिति</div>
                    </div>
                </div>
                <div style="margin-top:10px; display:flex; justify-content:space-between; align-items:center; font-size:12px; flex-wrap:wrap; gap:8px;">
                    <span class="text-muted">पंजीकरण: <strong>${res.registration ? res.registration.split('T')[0] : '—'}</strong></span>
                    <a href="${contribLink}" target="_blank" class="link-btn">📜 योगदान इतिहास (Contributions) ↗</a>
                </div>
                <div style="margin-top:12px; padding-top:10px; border-top:1px dashed var(--border-color); display:flex; justify-content:flex-end; gap:8px;">
                    <button type="button" id="btn-use-this-user" class="btn btn-primary btn-sm">
                        ✓ इस खाते से उपकरण प्रारंभ करें
                    </button>
                </div>
            </div>`;

        if (res.isAutoconfirmed) {
            state.auth = Object.assign(state.auth, res, { isLoggedIn: true, verified: true });
            localStorage.setItem('da_wiki_user', res.username);
            localStorage.setItem('da_username', res.username);
            updateAccessControlUI(state.auth);
        }

        const useBtn = document.getElementById('btn-use-this-user');
        if (useBtn) {
            useBtn.addEventListener('click', () => {
                state.auth = Object.assign(state.auth, res, { isLoggedIn: true, verified: true });
                localStorage.setItem('da_wiki_user', res.username);
                localStorage.setItem('da_username', res.username);
                updateAccessControlUI(state.auth);
                const modal = document.getElementById('login-modal');
                if (modal) modal.style.display = 'none';
                logMessage('विकिपीडिया खाता <b>' + escapeHtml(res.username) + '</b> सक्रिय। उपकरण अनलॉक हो गया है।', 'success');
            });
        }
    }

    // सदस्य न्यूनतम पात्रता सत्यापन
    async function checkUserEligibility(username) {
        if (!username) return null;
        const cleanName = username.trim().replace(/^सदस्य:/i, '').replace(/^User:/i, '');

        try {
            const localDataPromise = fetchWikipediaAPI({
                action: 'query',
                list: 'users',
                ususers: cleanName,
                usprop: 'groups|rights|editcount|registration',
                formatversion: 2
            });
            const centralPromise = fetchCentralAuthInfo(cleanName);

            const [data, central] = await Promise.all([localDataPromise, centralPromise]);

            const user = data.query && data.query.users ? data.query.users[0] : null;
            const existsLocally = user && user.missing === undefined;
            const existsGlobally = central && central.id;

            if (!existsLocally && !existsGlobally) {
                return { exists: false, username: cleanName, message: 'यह सदस्य नाम विकिपीडिया पर नहीं मिला।' };
            }

            const groups = (user && user.groups) || (central && central.groups) || [];
            const rights = (user && user.rights) || [];
            const editCount = (user && user.editcount) || (central && central.globalEditCount) || 0;
            const regDate = (user && user.registration) ? new Date(user.registration) : ((central && central.registration) ? new Date(central.registration) : new Date(0));
            const daysOld = regDate.getTime() > 0 ? Math.max(0, Math.floor((Date.now() - regDate.getTime()) / (1000 * 60 * 60 * 24))) : 999;

            const hasGroup = groups.includes('autoconfirmed') || groups.includes('sysop') || groups.includes('bot') || groups.includes('rollbacker') || groups.includes('patroller');
            const hasRight = rights.includes('autoconfirmed');
            const meetsThreshold = (daysOld >= 4 && editCount >= 10);
            const isAutoconfirmed = hasGroup || hasRight || meetsThreshold || (central && central.globalEditCount >= 10);

            const isBot = groups.includes('bot') || cleanName.toLowerCase().endsWith('bot');
            const isSysop = groups.includes('sysop');

            return {
                exists: true,
                userid: user ? user.userid : (central ? central.id : 0),
                username: cleanName,
                groups: groups,
                editCount: editCount,
                registration: user && user.registration ? user.registration : (central ? central.registration : ''),
                daysOld: daysOld,
                isAutoconfirmed: isAutoconfirmed,
                isBot: isBot,
                isSysop: isSysop,
                central: central
            };
        } catch (err) {
            console.error('User verification error:', err);
            return { exists: false, error: err.message };
        }
    }

    // एक्सेस कंट्रोल एवं हेडर बैज प्रबंधन (Access Control & Header UI)
    function updateAccessControlUI(info) {
        if (!info) info = state.auth;
        const isAuth = !!(info && info.isLoggedIn && info.isAutoconfirmed);

        const gateCard = document.getElementById('auth-gate-card');
        const workspace = document.getElementById('tool-workspace');
        const pill = document.getElementById('logged-user-pill');
        const loginBtn = document.getElementById('btn-open-login');

        if (isAuth) {
            if (gateCard) gateCard.style.display = 'none';
            if (workspace) workspace.style.display = 'block';
            if (loginBtn) loginBtn.style.display = 'none';
            if (pill) {
                pill.style.display = 'inline-flex';
                const nameEl = document.getElementById('logged-user-name');
                if (nameEl) nameEl.textContent = info.username;
                const avatarEl = document.getElementById('user-avatar-initial');
                if (avatarEl) avatarEl.textContent = (info.username[0] || 'व').toUpperCase();

                const badgeEl = document.getElementById('logged-user-badge');
                if (badgeEl) {
                    if (info.isBot) {
                        badgeEl.className = 'badge-bot';
                        badgeEl.textContent = '🤖 बॉट';
                    } else if (info.isSysop) {
                        badgeEl.className = 'badge-sysop';
                        badgeEl.textContent = '🛡️ प्रबंधक';
                    } else {
                        badgeEl.className = 'badge-autoconfirmed';
                        badgeEl.textContent = '✓ विकिपीडिया खाता';
                    }
                }
            }
        } else {
            if (gateCard) gateCard.style.display = 'block';
            if (workspace) workspace.style.display = 'none';
            if (loginBtn) loginBtn.style.display = 'inline-flex';
            if (pill) pill.style.display = 'none';
        }
    }

    function updateAuthBadgeUI(info) {
        updateAccessControlUI(info);
    }

    function openLoginModal(tabId = 'ltab-verify') {
        document.querySelectorAll('.login-tab-pane').forEach(p => p.style.display = 'none');
        document.querySelectorAll('[data-ltab]').forEach(b => b.classList.remove('active'));

        const targetPane = document.getElementById(tabId);
        const targetBtn = document.querySelector(`[data-ltab="${tabId}"]`);
        if (targetPane) targetPane.style.display = 'block';
        if (targetBtn) targetBtn.classList.add('active');

        const uInput = document.getElementById('verify-username-input');
        if (uInput && !uInput.value && state.auth.username) {
            uInput.value = state.auth.username;
        }

        document.getElementById('login-modal').style.display = 'flex';
    }

    async function loadPage(pageTitle) {
        const cleanTitle = pageTitle.trim().replace(/^\[\[/, '').replace(/\]\]$/, '');
        if (!cleanTitle) {
            alert('कृपया मान्य पृष्ठ शीर्षक दर्ज करें।');
            return;
        }

        const btn = document.getElementById('load-page-btn');
        btn.disabled = true;
        btn.innerHTML = '<span class="btn-icon">⏳</span> लोड हो रहा है...';
        logMessage(`पृष्ठ <b>${cleanTitle}</b> लोड किया जा रहा है...`, 'info');

        try {
            const data = await fetchWikipediaAPI({
                action: 'query',
                prop: 'revisions|info',
                titles: cleanTitle,
                rvprop: 'content|timestamp',
                rvslots: 'main',
                redirects: 1,
                formatversion: 2
            });

            const page = data.query && data.query.pages ? data.query.pages[0] : null;
            if (!page || page.missing) {
                logMessage(`त्रुटि: पृष्ठ <b>${cleanTitle}</b> हिन्दी विकिपीडिया पर उपलब्ध नहीं है।`, 'error');
                alert(`त्रुटि: पृष्ठ '${cleanTitle}' विकिपीडिया पर नहीं मिला।`);
                btn.disabled = false;
                btn.innerHTML = '<span class="btn-icon">⚡</span> पृष्ठ लोड करें';
                return;
            }

            state.currentPageTitle = page.title;
            state.currentBaseTimestamp = (page.revisions && page.revisions[0]) ? page.revisions[0].timestamp : '';
            state.currentWikitext = (page.revisions && page.revisions[0] && page.revisions[0].slots && page.revisions[0].slots.main)
                ? page.revisions[0].slots.main.content : '';

            state.parsedData = parseWikitextIntoSections(state.currentWikitext);
            state.selectedIndices.clear();

            updateStatusBar();
            renderSectionsTable();
            document.getElementById('sections-section').style.display = 'block';
            document.getElementById('actions-section').style.display = 'block';

            checkExistingArchives(state.currentPageTitle);

            logMessage(`पृष्ठ <b>${page.title}</b> लोड संपन्न। कुल <b>${state.parsedData.sections.length}</b> अनुभाग पाए गए।`, 'success');
        } catch (err) {
            logMessage(`पृष्ठ लोड में विफलता: ${err.message}`, 'error');
            alert(`त्रुटि: ${err.message}`);
        } finally {
            btn.disabled = false;
            btn.innerHTML = '<span class="btn-icon">⚡</span> पृष्ठ लोड करें';
        }
    }

    async function checkExistingArchives(basePage) {
        const parts = basePage.split(':');
        const titleWithoutNs = parts.length > 1 ? parts.slice(1).join(':') : basePage;
        const prefix = `${titleWithoutNs}/`;

        const boxEl = document.getElementById('existing-archives-box');
        const chipsEl = document.getElementById('archives-list-chips');
        chipsEl.innerHTML = '<span class="text-muted">पुरालेख उप-पृष्ठ खोजे जा रहे हैं...</span>';
        boxEl.style.display = 'block';

        try {
            const data = await fetchWikipediaAPI({
                action: 'query',
                generator: 'allpages',
                gapprefix: prefix,
                gaplimit: 500,
                prop: 'info',
                formatversion: 2
            });

            const pages = data.query && data.query.pages ? data.query.pages : [];
            pages.sort((a, b) => a.title.localeCompare(b.title, 'hi'));

            state.existingArchives = pages;
            let maxArchiveNum = 0;
            let latestTitle = '';
            let latestKB = 0;
            const numRegex = /\/(?:पुरालेख|Archive)[ _]*(\d+)$/i;

            for (let i = 0; i < pages.length; i++) {
                const clean = normalizeDevanagariDigits(pages[i].title);
                const m = clean.match(numRegex);
                if (m && m[1]) {
                    const n = parseInt(m[1], 10);
                    if (n < 1900 && n >= maxArchiveNum) {
                        maxArchiveNum = n;
                        latestTitle = pages[i].title;
                        latestKB = Math.round((pages[i].length || 0) / 1024);
                    }
                }
            }

            state.suggestedArchiveTitle = `${basePage}/पुरालेख ${maxArchiveNum > 0 ? maxArchiveNum + 1 : 1}`;
            state.latestArchiveSizeKB = latestKB;

            chipsEl.innerHTML = '';
            if (pages.length === 0) {
                chipsEl.innerHTML = `<span class="text-muted">कोई मौजूदा पुरालेख नहीं मिला।</span>
                    <button type="button" class="chip chip-selected" data-title="${state.suggestedArchiveTitle}">${state.suggestedArchiveTitle} (नया सुझाईत)</button>`;
                document.getElementById('archive-target-input').value = state.suggestedArchiveTitle;
            } else {
                pages.forEach(p => {
                    const kb = Math.round((p.length || 0) / 1024);
                    const chip = document.createElement('button');
                    chip.type = 'button';
                    chip.className = 'chip' + (p.title === latestTitle ? ' chip-selected' : '');
                    chip.dataset.title = p.title;
                    chip.innerHTML = `${p.title} <strong>(${kb} KB)</strong>`;
                    chip.addEventListener('click', () => {
                        document.querySelectorAll('.chip').forEach(c => c.classList.remove('chip-selected'));
                        chip.classList.add('chip-selected');
                        document.getElementById('archive-target-input').value = p.title;
                    });
                    chipsEl.appendChild(chip);
                });

                const nextChip = document.createElement('button');
                nextChip.type = 'button';
                nextChip.className = 'chip';
                nextChip.style.borderColor = 'var(--primary)';
                nextChip.dataset.title = state.suggestedArchiveTitle;
                nextChip.innerHTML = `+ नया: ${state.suggestedArchiveTitle}`;
                nextChip.addEventListener('click', () => {
                    document.querySelectorAll('.chip').forEach(c => c.classList.remove('chip-selected'));
                    nextChip.classList.add('chip-selected');
                    document.getElementById('archive-target-input').value = state.suggestedArchiveTitle;
                });
                chipsEl.appendChild(nextChip);

                document.getElementById('archive-target-input').value = latestTitle || state.suggestedArchiveTitle;
            }
        } catch (err) {
            chipsEl.innerHTML = `<span class="text-danger">जाँच में त्रुटि: ${err.message}</span>`;
        }
    }

    // =========================================================================
    // 5. UI रेंडरिंग एवं घटना प्रबंधन (Event Handling)
    // =========================================================================

    function updateStatusBar() {
        const bar = document.getElementById('page-status-bar');
        const sections = state.parsedData ? state.parsedData.sections : [];

        const total = sections.length;
        const closed = sections.filter(s => s.isClosed).length;
        const empty = sections.filter(s => s.isEmpty).length;
        const open = total - closed - empty;

        document.getElementById('loaded-page-link').textContent = state.currentPageTitle;
        document.getElementById('stat-total').textContent = `कुल: ${total}`;
        document.getElementById('stat-open').textContent = `सक्रिय: ${open}`;
        document.getElementById('stat-closed').textContent = `समाप्त: ${closed}`;
        document.getElementById('stat-empty').textContent = `रिक्त: ${empty}`;

        const boxStat = document.getElementById('stat-box');
        if (state.parsedData.hasArchiveBox) {
            boxStat.className = 'badge badge-success';
            boxStat.textContent = 'पुरालेख पेटी: उपस्थित';
        } else {
            boxStat.className = 'badge badge-neutral';
            boxStat.textContent = 'पुरालेख पेटी: अनुपस्थित';
        }

        const viewLink = document.getElementById('wiki-view-link');
        const histLink = document.getElementById('wiki-history-link');
        viewLink.href = `https://hi.wikipedia.org/wiki/${encodeURIComponent(state.currentPageTitle)}`;
        histLink.href = `https://hi.wikipedia.org/w/index.php?title=${encodeURIComponent(state.currentPageTitle)}&action=history`;

        bar.style.display = 'flex';
    }

    function renderSectionsTable() {
        const tbody = document.getElementById('sections-tbody');
        tbody.innerHTML = '';
        const sections = state.parsedData ? state.parsedData.sections : [];

        if (sections.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted" style="padding:16px;">इस पृष्ठ पर कोई द्वितीय-स्तरीय अनुभाग (== शीर्षक ==) नहीं मिला।</td></tr>';
            updateSelectedCounter();
            return;
        }

        sections.forEach((sec, idx) => {
            const tr = document.createElement('tr');
            tr.dataset.index = idx;
            tr.dataset.title = sec.cleanTitle.toLowerCase();

            let statusBadge = '<span class="badge badge-success">सक्रिय</span>';
            if (sec.isEmpty) {
                statusBadge = '<span class="badge badge-danger">रिक्त</span>';
            } else if (sec.isClosed) {
                statusBadge = '<span class="badge badge-warning">समाप्त</span>';
            }

            let dateHtml = sec.lastDateStr;
            if (!sec.isEmpty && sec.daysInactive >= 0) {
                const colorClass = sec.daysInactive >= 30 ? 'text-danger font-bold' : 'text-muted';
                dateHtml += ` <small class="${colorClass}">(${sec.daysInactive} दिन)</small>`;
            }

            const participantInfo = `${sec.commentCount}${sec.uniqueUsers > 0 ? ' / ' + sec.uniqueUsers : ''}`;

            tr.innerHTML = `
                <td class="col-check text-center">
                    <input type="checkbox" class="sec-checkbox" data-idx="${idx}" ${state.selectedIndices.has(idx) ? 'checked' : ''} />
                </td>
                <td class="col-num text-center">${sec.index}</td>
                <td class="col-title">
                    <strong>${escapeHtml(sec.title)}</strong>
                    <small class="text-muted">(${formatBytes(sec.sizeBytes)})</small>
                </td>
                <td class="col-meta text-center">${participantInfo}</td>
                <td class="col-date text-center">${dateHtml}</td>
                <td class="col-status text-center">${statusBadge}</td>
                <td class="col-actions text-center">
                    <button type="button" class="btn btn-outline btn-xs view-sec-btn" data-idx="${idx}" title="विकिटेक्स्ट देखें">देखें</button>
                    <button type="button" class="btn btn-outline btn-xs copy-link-btn" data-idx="${idx}" title="कड़ी कॉपी करें">कड़ी</button>
                </td>
            `;

            tbody.appendChild(tr);
        });

        updateSelectedCounter();
    }

    function updateSelectedCounter() {
        const count = state.selectedIndices.size;
        document.getElementById('selected-counter').textContent = count;
        const master = document.getElementById('master-checkbox');
        const total = state.parsedData ? state.parsedData.sections.length : 0;
        master.checked = (total > 0 && count === total);
    }

    // =========================================================================
    // 6. कार्यप्रणाली: समापन, पुरालेख, बॉट एवं सीधा संपादन
    // =========================================================================

    function executeClosePreview() {
        if (state.selectedIndices.size === 0) {
            alert('कृपया समाप्त करने हेतु कम से कम एक अनुभाग चुनें।');
            return;
        }

        const formatType = document.getElementById('close-format').value;
        const statusLabel = document.getElementById('close-status').value;
        const badgeTpl = document.getElementById('close-badge').value;
        const verdictText = document.getElementById('close-verdict').value.trim();

        const clonedSections = state.parsedData.sections.map(s => Object.assign({}, s));
        const closedTitles = [];

        state.selectedIndices.forEach(idx => {
            const sec = clonedSections[idx];
            if (!sec.isClosed) {
                sec.fullText = buildClosedSectionWikitext(sec, statusLabel, badgeTpl, verdictText, formatType);
                sec.isClosed = true;
                closedTitles.push(sec.cleanTitle);
            }
        });

        if (closedTitles.length === 0) {
            alert('चयनित सभी अनुभाग पहले से ही समाप्त घोषित हैं।');
            return;
        }

        const newSourceWikitext = (state.parsedData.lead || '') + clonedSections.map(s => s.fullText).join('');
        const editSummary = `चर्चा समापन (${statusLabel}): ${closedTitles.join(', ')} ([[विकिपीडिया:चर्चा समापन उपकरण|चर्चा प्रबंधन उपकरण]])`;

        showPreviewModal({
            title: `चर्चा समापन पूर्वावलोकन (${closedTitles.length} अनुभाग)`,
            summary: editSummary,
            sourceText: newSourceWikitext,
            archiveText: null,
            targetPage: state.currentPageTitle
        });
    }

    function executeArchiveWorkflow(closeBeforeArchive) {
        if (state.selectedIndices.size === 0) {
            alert('कृपया पुरालेख में स्थानांतरित करने हेतु कम से कम एक अनुभाग चुनें।');
            return;
        }

        let targetArchive = document.getElementById('archive-target-input').value.trim();
        if (!targetArchive || targetArchive === state.currentPageTitle) {
            alert('कृपया मान्य लक्षित पुरालेख पृष्ठ दर्ज करें।');
            return;
        }

        const autoSplit = document.getElementById('chk-auto-split').checked;
        const maxSizeKB = parseInt(document.getElementById('select-max-size').value, 10) || 100;
        if (autoSplit && state.latestArchiveSizeKB >= maxSizeKB && state.suggestedArchiveTitle) {
            logMessage(`सूचना: पुरालेख पृष्ठ (${targetArchive}) का आकार सीमा पार कर चुका है, स्वतः नया क्रमांक <b>${state.suggestedArchiveTitle}</b> चुना गया।`, 'warning');
            targetArchive = state.suggestedArchiveTitle;
            document.getElementById('archive-target-input').value = targetArchive;
        }

        const leaveStub = document.getElementById('chk-leave-stub').checked;
        const autoAddBox = document.getElementById('chk-auto-add-box').checked;
        const headerTpl = document.getElementById('archive-header-tpl').value;

        const statusLabel = document.getElementById('close-status').value;
        const badgeTpl = document.getElementById('close-badge').value;
        const formatType = document.getElementById('close-format').value;
        const verdictText = document.getElementById('close-verdict').value.trim();

        const toArchive = [];
        const toRemain = [];
        const archivedTitles = [];

        state.parsedData.sections.forEach((sec, idx) => {
            const secCopy = Object.assign({}, sec);
            if (state.selectedIndices.has(idx)) {
                if (closeBeforeArchive && !secCopy.isClosed) {
                    secCopy.fullText = buildClosedSectionWikitext(secCopy, statusLabel, badgeTpl, verdictText, formatType);
                    secCopy.isClosed = true;
                }
                toArchive.push(secCopy);
                archivedTitles.push(secCopy.cleanTitle);

                if (leaveStub) {
                    const stub = `${secCopy.rawHeading}\n:''यह चर्चा [[${targetArchive}#${secCopy.cleanTitle}|${targetArchive}]] में स्थानांतरित कर दी गई है।''\n\n`;
                    toRemain.push({ fullText: stub });
                }
            } else {
                toRemain.push(secCopy);
            }
        });

        const archiveBlock = toArchive.map(s => s.fullText.trim()).join('\n\n');
        const fullArchiveText = headerTpl ? `${headerTpl}\n\n${archiveBlock}\n` : `\n\n${archiveBlock}\n`;

        let newLead = state.parsedData.lead || '';
        if (autoAddBox && !state.parsedData.hasArchiveBox) {
            newLead = `{{पुरालेख पेटी|auto=yes|search=yes}}\n${newLead}`;
        }
        const newSourceWikitext = newLead + toRemain.map(s => s.fullText).join('');

        const actionPrefix = closeBeforeArchive ? 'चर्चा समापन एवं पुरालेखण: ' : 'पुरालेखण: ';
        const sourceSummary = `${actionPrefix}${archivedTitles.length} चर्चा अनुभाग [[${targetArchive}]] में स्थानांतरित ([[विकिपीडिया:पुरालेखन|पुरालेखण उपकरण]])`;
        const targetSummary = `${actionPrefix}[${state.currentPageTitle}]] से ${archivedTitles.length} चर्चा अनुभाग जोड़े गए ([[विकिपीडिया:पुरालेखन|पुरालेखण उपकरण]])`;

        showPreviewModal({
            title: `पुरालेख स्थानांतरण पूर्वावलोकन (${archivedTitles.length} अनुभाग)`,
            summary: sourceSummary,
            sourceText: newSourceWikitext,
            archiveText: fullArchiveText,
            targetPage: state.currentPageTitle,
            archivePage: targetArchive,
            archiveSummary: targetSummary
        });
    }

    // सीधे विकिपीडिया पर संपादन सुरक्षित करना (Direct Save via Active Browser Session / API)
    function executeDirectWikipediaEdit() {
        if (!state.activePreviewPayload) return;

        if (!state.auth.isAutoconfirmed) {
            alert('त्रुटि: सीधे विकिपीडिया पर सहेजने हेतु सदस्य का "स्वतः स्थापित सदस्य" (Autoconfirmed) होना अनिवार्य है। कृपया पहले अपनी पात्रता सत्यापित करें।');
            openLoginModal('ltab-verify');
            return;
        }

        const payload = state.activePreviewPayload;
        const isBotFlag = document.getElementById('chk-bot-flag') ? document.getElementById('chk-bot-flag').checked : false;

        logMessage(`पृष्ठ <b>${payload.targetPage}</b> पर सीधा संपादन शुरू किया जा रहा है...`, 'info');

        // सक्रिय विकिपीडिया ब्राउज़र सत्र के माध्यम से सुरक्षित फ़ॉर्म पोस्ट
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = `https://hi.wikipedia.org/w/index.php?title=${encodeURIComponent(payload.targetPage)}&action=submit`;
        form.target = '_blank';

        const wpTextbox = document.createElement('textarea');
        wpTextbox.name = 'wpTextbox1';
        wpTextbox.value = payload.sourceText;
        form.appendChild(wpTextbox);

        const wpSummary = document.createElement('input');
        wpSummary.type = 'hidden';
        wpSummary.name = 'wpSummary';
        wpSummary.value = payload.summary;
        form.appendChild(wpSummary);

        const wpDiff = document.createElement('input');
        wpDiff.type = 'hidden';
        wpDiff.name = 'wpDiff';
        wpDiff.value = '1';
        form.appendChild(wpDiff);

        if (isBotFlag) {
            const wpMinoredit = document.createElement('input');
            wpMinoredit.type = 'hidden';
            wpMinoredit.name = 'wpMinoredit';
            wpMinoredit.value = '1';
            form.appendChild(wpMinoredit);
        }

        document.body.appendChild(form);
        form.submit();
        document.body.removeChild(form);

        // यदि पुरालेख पृष्ठ भी है तो उसे भी खोलें
        if (payload.archiveText && payload.archivePage) {
            setTimeout(() => {
                const aForm = document.createElement('form');
                aForm.method = 'POST';
                aForm.action = `https://hi.wikipedia.org/w/index.php?title=${encodeURIComponent(payload.archivePage)}&action=submit`;
                aForm.target = '_blank';

                const aBox = document.createElement('textarea');
                aBox.name = 'wpTextbox1';
                aBox.value = payload.archiveText;
                aForm.appendChild(aBox);

                const aSum = document.createElement('input');
                aSum.type = 'hidden';
                aSum.name = 'wpSummary';
                aSum.value = payload.archiveSummary || 'पुरालेख चर्चा जोड़ी गई';
                aForm.appendChild(aSum);

                const aDiff = document.createElement('input');
                aDiff.type = 'hidden';
                aDiff.name = 'wpDiff';
                aDiff.value = '1';
                aForm.appendChild(aDiff);

                document.body.appendChild(aForm);
                aForm.submit();
                document.body.removeChild(aForm);
            }, 1200);
        }

        logMessage(`सफलता: संपादन विकिपीडिया पर पूर्वावलोकन के साथ नए टैब में खोल दिया गया।`, 'success');
        alert(`सफलता! विकिपीडिया पर संपादन पृष्ठ खुल गया है। आपका खाता पहले से लॉगिन होने के कारण आप बस 'बदलाव सहेजें' बटन दबा सकते हैं।`);
    }

    // एकल ऑफ़लाइन फ़ाइल बंडल डाउनलोडर
    async function downloadStandaloneBundle() {
        logMessage('एकल ऑफ़लाइन HTML फ़ाइल बंडल तैयार किया जा रहा है...', 'info');

        try {
            // वर्तमान HTML, CSS और JS को एकल फ़ाइल में संकलित करें
            const cssResp = await fetch('style.css');
            const cssText = cssResp.ok ? await cssResp.text() : '';

            const jsResp = await fetch('app.js');
            const jsText = jsResp.ok ? await jsResp.text() : '';

            let docHtml = document.documentElement.outerHTML;

            // बाहरी स्टाइल व स्क्रिप्ट को इनलाइन करें
            docHtml = docHtml.replace(/<link\s+rel="stylesheet"\s+href="style\.css"[^>]*>/i, `<style>\n${cssText}\n</style>`);
            docHtml = docHtml.replace(/<script\s+src="app\.js"[^>]*><\/script>/i, `<script>\n${jsText}\n</script>`);

            const blob = new Blob(['<!DOCTYPE html>\n' + docHtml], { type: 'text/html;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'DiscussionArchiver_Standalone.html';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            logMessage('<b>DiscussionArchiver_Standalone.html</b> डाउनलोड सफलतापूर्वक आरंभ हुआ!', 'success');
        } catch (err) {
            logMessage(`फ़ाइल डाउनलोड में त्रुटि: ${err.message}`, 'error');
            window.open('DiscussionArchiver_Standalone.html', '_blank');
        }
    }

    // स्वचालित बॉट कार्य
    function scanBotEligibleSections() {
        const minDays = parseInt(document.getElementById('bot-min-inactive-days').value, 10) || 30;
        let count = 0;
        state.selectedIndices.clear();

        state.parsedData.sections.forEach((sec, idx) => {
            if (!sec.isEmpty && sec.daysInactive >= minDays) {
                state.selectedIndices.add(idx);
                count++;
            }
        });

        renderSectionsTable();
        logMessage(`बॉट स्कैन: <b>${minDays}+ दिन</b> निष्क्रिय कुल <b>${count}</b> चर्चा अनुभाग मिले।`, 'info');
        alert(`बॉट स्कैन संपन्न: ${count} चर्चा अनुभाग ${minDays}+ दिन से निष्क्रिय मिले और चुन लिए गए हैं।`);
    }

    function startBotAutomation() {
        if (!state.auth.isAutoconfirmed) {
            alert('त्रुटि: बॉट ऑटोमेशन चलाने के लिए सदस्य का "स्वतः स्थापित सदस्य" (Autoconfirmed) होना अनिवार्य है।');
            openLoginModal('ltab-verify');
            return;
        }

        if (state.selectedIndices.size === 0) {
            alert('बॉट के लिए कोई अनुभाग चयनित नहीं है। पहले "पात्र चर्चाएँ स्कैन करें" पर क्लिक करें।');
            return;
        }

        const autoClose = document.getElementById('chk-bot-auto-close').checked;
        const delay = parseInt(document.getElementById('bot-edit-delay').value, 10) || 5000;

        const tag = document.getElementById('bot-status-tag');
        tag.className = 'badge badge-success';
        tag.innerHTML = '<span class="pulse-indicator"></span> बॉट सक्रिय';

        document.getElementById('btn-bot-start').style.display = 'none';
        document.getElementById('btn-bot-stop').style.display = 'inline-flex';

        logMessage(`बॉट ऑटोमेशन प्रारंभ: ${state.selectedIndices.size} अनुभागों का पुरालेखन (अंतराल: ${delay/1000}s)...`, 'info');
        executeArchiveWorkflow(autoClose);
    }

    function stopBotAutomation() {
        const tag = document.getElementById('bot-status-tag');
        tag.className = 'badge badge-neutral';
        tag.textContent = 'बॉट निष्क्रिय';

        document.getElementById('btn-bot-start').style.display = 'inline-flex';
        document.getElementById('btn-bot-stop').style.display = 'none';

        logMessage('बॉट ऑटोमेशन रोक दिया गया।', 'warning');
    }

    // चर्चा अन्य वार्ता / परियोजना पृष्ठ पर स्थानांतरित करना (Move Thread / Cut to another page)
    function executeRelocateWorkflow() {
        if (state.selectedIndices.size === 0) {
            alert('कृपया स्थानांतरित करने हेतु कम से कम एक चर्चा अनुभाग चुनें।');
            return;
        }

        const targetInput = document.getElementById('relocate-target-input');
        const targetPage = targetInput ? targetInput.value.trim() : '';

        if (!targetPage) {
            alert('कृपया गंतव्य पृष्ठ का नाम दर्ज करें (उदा: विकिपीडिया:प्रबन्धक सूचनापट)।');
            if (targetInput) targetInput.focus();
            return;
        }

        if (targetPage.toLowerCase() === state.currentPageTitle.toLowerCase()) {
            alert('गंतव्य पृष्ठ वर्तमान पृष्ठ से भिन्न होना चाहिए।');
            return;
        }

        const leaveStub = document.getElementById('chk-relocate-stub') ? document.getElementById('chk-relocate-stub').checked : true;
        const toRelocate = [];
        const toRemain = [];
        const relocatedTitles = [];

        state.parsedData.sections.forEach((sec, idx) => {
            const secCopy = Object.assign({}, sec);
            if (state.selectedIndices.has(idx)) {
                toRelocate.push(secCopy);
                relocatedTitles.push(secCopy.cleanTitle);

                if (leaveStub) {
                    const stub = `${secCopy.rawHeading}\n:{{स्थानांतरित|गंतव्य=[[${targetPage}#${secCopy.cleanTitle}]]}} --~~~~\\n\n`;
                    toRemain.push({ fullText: stub });
                }
            } else {
                toRemain.push(secCopy);
            }
        });

        const newSourceWikitext = (state.parsedData.lead || '') + toRemain.map(s => s.fullText).join('');

        const destSections = toRelocate.map(s => {
            const cleanBody = s.bodyText.replace(/^\r?\n/, '').replace(/\s+$/, '');
            return `${s.rawHeading}\n:''यह चर्चा [[${state.currentPageTitle}]] से स्थानांतरित होकर यहाँ लाई गई है।'' --~~~~\n\n${cleanBody}\n`;
        }).join('\n');

        const sourceSummary = `चर्चा स्थानांतरण: ${relocatedTitles.length} चर्चा अनुभाग [[${targetPage}]] पर स्थानांतरित किए गए ([[विकिपीडिया:चर्चा प्रबंधन उपकरण|उपकरण]])`;
        const targetSummary = `चर्चा स्थानांतरण: [[${state.currentPageTitle}]] से ${relocatedTitles.length} चर्चा अनुभाग यहाँ जोड़े गए ([[विकिपीडिया:चर्चा प्रबंधन उपकरण|उपकरण]])`;

        showPreviewModal({
            title: `चर्चा स्थानांतरण पूर्वावलोकन (${relocatedTitles.length} अनुभाग)`,
            summary: sourceSummary,
            sourceText: newSourceWikitext,
            archiveText: destSections,
            targetPage: state.currentPageTitle,
            archivePage: targetPage,
            archiveSummary: targetSummary
        });
    }

    // चयनित चर्चाएँ पृष्ठ से काटना / विलोपित करना (Cut / Delete Selected Sections)
    function executeDeleteSectionsWorkflow() {
        if (state.selectedIndices.size === 0) {
            alert('कृपया काटने/हटाने हेतु कम से कम एक चर्चा अनुभाग चुनें।');
            return;
        }

        const count = state.selectedIndices.size;
        const confirmMsg = `क्या आप वाकई चयनित ${count} चर्चा अनुभाग(ओं) को वर्तमान पृष्ठ से काटना/हटाना चाहते हैं?`;
        if (!confirm(confirmMsg)) return;

        const toRemain = [];
        const deletedTitles = [];

        state.parsedData.sections.forEach((sec, idx) => {
            if (state.selectedIndices.has(idx)) {
                deletedTitles.push(sec.cleanTitle);
            } else {
                toRemain.push(sec);
            }
        });

        const newSourceWikitext = (state.parsedData.lead || '') + toRemain.map(s => s.fullText).join('');
        const editSummary = `सफ़ाई: ${deletedTitles.length} अप्रचलित/अनुचित चर्चा अनुभाग हटाए गए (${deletedTitles.join(', ')}) ([[विकिपीडिया:चर्चा प्रबंधन उपकरण|उपकरण]])`;

        showPreviewModal({
            title: `चर्चा विलोपन / सफ़ाई (${deletedTitles.length} अनुभाग)`,
            summary: editSummary,
            sourceText: newSourceWikitext,
            archiveText: null,
            targetPage: state.currentPageTitle
        });
    }

    // मोडल प्रदर्शन
    function showPreviewModal(opts) {
        state.activePreviewPayload = opts;

        document.getElementById('modal-title').textContent = opts.title;
        document.getElementById('modal-summary-badge').innerHTML = `<strong>संपादन सारांश:</strong> ${escapeHtml(opts.summary)}`;

        const previewSource = document.getElementById('preview-textarea-source');
        const previewArchive = document.getElementById('preview-textarea-archive');
        const modalTabs = document.getElementById('modal-tabs');
        const pSourcePane = document.getElementById('p-source');
        const pArchivePane = document.getElementById('p-archive');

        previewSource.value = opts.sourceText;

        const tabBtns = document.querySelectorAll('.preview-tab-btn');
        if (tabBtns.length >= 2) {
            tabBtns.forEach(b => b.classList.remove('active'));
            tabBtns[0].classList.add('active');
            tabBtns[0].textContent = `मूल पृष्ठ: ${opts.targetPage}`;
            if (opts.archivePage) {
                tabBtns[1].textContent = (opts.archivePage.includes('पुरालेख') ? 'पुरालेख पृष्ठ: ' : 'गंतव्य पृष्ठ: ') + opts.archivePage;
            } else {
                tabBtns[1].textContent = 'द्वितीयक पृष्ठ विकिटेक्स्ट';
            }
        }
        pSourcePane.style.display = 'block';
        pArchivePane.style.display = 'none';

        if (opts.archiveText) {
            previewArchive.value = opts.archiveText;
            modalTabs.style.display = 'flex';
        } else {
            modalTabs.style.display = 'none';
        }

        const userBadge = document.getElementById('modal-user-attribution-badge');
        if (userBadge) {
            const uName = state.auth.username || 'अज्ञात';
            userBadge.innerHTML = `👤 <strong>संपादन कर्ता:</strong> <a href="https://hi.wikipedia.org/wiki/Special:Contributions/${encodeURIComponent(uName)}" target="_blank" class="link-btn">सदस्य:${escapeHtml(uName)} (योगदान देखें ↗)</a> &nbsp;|&nbsp; <em>यह संपादन सीधे आपके विकिपीडिया खाते के योगदान (Contributions) में जुड़ेगा।</em>`;
        }

        const wikiEditBtn = document.getElementById('btn-open-wiki-edit');
        wikiEditBtn.href = `https://hi.wikipedia.org/w/index.php?title=${encodeURIComponent(opts.targetPage)}&action=edit`;
        wikiEditBtn.textContent = 'विकिपीडिया पर संपादन खोलें ↗';

        const copyBtn = document.getElementById('btn-copy-preview');
        copyBtn.onclick = () => {
            const activeTab = document.querySelector('.preview-tab-btn.active');
            const isArchiveActive = activeTab && activeTab.dataset.ptab === 'p-archive';
            const textToCopy = isArchiveActive ? opts.archiveText : opts.sourceText;

            navigator.clipboard.writeText(textToCopy).then(() => {
                logMessage('विकिटेक्स्ट क्लिपबोर्ड पर सफलतापूर्वक कॉपी किया गया।', 'success');
                alert('विकिटेक्स्ट क्लिपबोर्ड पर कॉपी हो गया! अब आप विकिपीडिया संपादन पृष्ठ पर पेस्ट कर सकते हैं।');
            }).catch(e => {
                alert('कॉपी करने में त्रुटि: ' + e.message);
            });
        };

        const apiBtn = document.getElementById('btn-confirm-api-edit');
        if (apiBtn) {
            apiBtn.style.display = 'inline-flex';
            apiBtn.onclick = executeDirectWikipediaEdit;
        }

        document.getElementById('preview-modal').style.display = 'flex';
    }

    // =========================================================================
    // 7. घटना श्रोता (Event Listeners Setup)
    // =========================================================================

    document.addEventListener('DOMContentLoaded', () => {
        // 1. थीम आरंभ
        document.documentElement.setAttribute('data-theme', state.theme);
        const themeBtn = document.getElementById('theme-toggle-btn');
        if (themeBtn) {
            themeBtn.addEventListener('click', () => {
                state.theme = state.theme === 'dark' ? 'light' : 'dark';
                document.documentElement.setAttribute('data-theme', state.theme);
                localStorage.setItem('da_theme', state.theme);
            });
        }

        // 2. प्रमाणीकरण व पात्रता आरंभ
        updateAuthBadgeUI(state.auth);

        // 3. लॉगिन व सेंट्रलऑथ मोडल Butons
        const openLoginBtn = document.getElementById('btn-open-login');
        if (openLoginBtn) {
            openLoginBtn.addEventListener('click', () => openLoginModal('ltab-verify'));
        }

        const switchUserBtn = document.getElementById('btn-switch-user');
        if (switchUserBtn) {
            switchUserBtn.addEventListener('click', () => openLoginModal('ltab-verify'));
        }

        const closeLoginBtn = document.getElementById('btn-close-login-modal');
        if (closeLoginBtn) {
            closeLoginBtn.addEventListener('click', () => {
                document.getElementById('login-modal').style.display = 'none';
            });
        }

        const dismissLoginBtn = document.getElementById('btn-dismiss-login-modal');
        if (dismissLoginBtn) {
            dismissLoginBtn.addEventListener('click', () => {
                document.getElementById('login-modal').style.display = 'none';
            });
        }

        // मोडल सब-टैब्स
        document.querySelectorAll('[data-ltab]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.login-tab-pane').forEach(p => p.style.display = 'none');
                document.querySelectorAll('[data-ltab]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const target = document.getElementById(btn.dataset.ltab);
                if (target) target.style.display = 'block';
            });
        });

        // 4. विकिमीडिया OAuth 2.0 प्रमाणीकरण बटन
        const oauthBtn = document.getElementById('btn-oauth-login');
        if (oauthBtn) oauthBtn.addEventListener('click', startWikimediaOAuthLogin);

        const modalOauthBtn = document.getElementById('btn-modal-oauth-login');
        if (modalOauthBtn) modalOauthBtn.addEventListener('click', startWikimediaOAuthLogin);

        const saveClientBtn = document.getElementById('btn-save-client-id');
        const clientIdInp = document.getElementById('oauth-client-id-input');
        if (clientIdInp) clientIdInp.value = getOAuthClientId();
        if (saveClientBtn && clientIdInp) {
            saveClientBtn.addEventListener('click', () => {
                const val = clientIdInp.value.trim();
                if (val) {
                    localStorage.setItem('da_oauth_client_id', val);
                    alert('OAuth Client ID सफलतापूर्वक सहेजा गया: ' + val);
                }
            });
        }

        // 5. लॉगआउट बटन
        const logoutBtn = document.getElementById('btn-logout');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                localStorage.removeItem('da_wiki_user');
                localStorage.removeItem('da_username');
                state.auth.isAutoconfirmed = false;
                state.auth.isLoggedIn = false;
                state.auth.username = '';
                state.auth.verified = false;
                updateAccessControlUI(state.auth);
                logMessage('सत्र समाप्त (लॉगआउट)। उपकरण लॉक हो गया है।', 'info');
            });
        }

        // 6. मोडल बंद करने के सामान्य श्रोता (Close on Overlay Click & Esc Key)
        const previewCloseBtn = document.getElementById('btn-close-modal');
        if (previewCloseBtn) {
            previewCloseBtn.addEventListener('click', () => {
                document.getElementById('preview-modal').style.display = 'none';
            });
        }

        const previewCancelBtn = document.getElementById('btn-cancel-modal');
        if (previewCancelBtn) {
            previewCancelBtn.addEventListener('click', () => {
                document.getElementById('preview-modal').style.display = 'none';
            });
        }

        // मोडल पृष्ठभूमि (Overlay) पर क्लिक करने पर बंद होना
        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', (e) => {
                if (e.target === overlay) {
                    overlay.style.display = 'none';
                }
            });
        });

        // Escape कुंजी दबाने पर मोडल बंद होना
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                document.querySelectorAll('.modal-overlay').forEach(m => m.style.display = 'none');
            }
        });

        // 7. पूर्वावलोकन मोडल सब-टैब्स
        document.querySelectorAll('.preview-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.preview-tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.preview-tab-pane').forEach(p => p.style.display = 'none');
                btn.classList.add('active');
                const targetPane = document.getElementById(btn.dataset.ptab);
                if (targetPane) targetPane.style.display = 'block';

                // यदि आर्काइव/गंतव्य सक्रिय है तो संपादन लिंक को तदनुसार बदलें
                const wikiEditBtn = document.getElementById('btn-open-wiki-edit');
                if (wikiEditBtn && state.activePreviewPayload) {
                    const isArchive = btn.dataset.ptab === 'p-archive' && state.activePreviewPayload.archivePage;
                    const pageToOpen = isArchive ? state.activePreviewPayload.archivePage : state.activePreviewPayload.targetPage;
                    wikiEditBtn.href = `https://hi.wikipedia.org/w/index.php?title=${encodeURIComponent(pageToOpen)}&action=edit`;
                    wikiEditBtn.textContent = `विकिपीडिया पर संपादन खोलें ↗`;
                }
            });
        });

        // 8. मुख्य कार्य Butons
        const prevCloseBtn = document.getElementById('btn-preview-close');
        if (prevCloseBtn) prevCloseBtn.addEventListener('click', executeClosePreview);

        const execCloseBtn = document.getElementById('btn-exec-close');
        if (execCloseBtn) execCloseBtn.addEventListener('click', executeClosePreview);

        const checkArchBtn = document.getElementById('btn-check-archives');
        if (checkArchBtn) {
            checkArchBtn.addEventListener('click', () => checkExistingArchives(state.currentPageTitle));
        }

        const prevArchBtn = document.getElementById('btn-preview-archive');
        if (prevArchBtn) prevArchBtn.addEventListener('click', () => executeArchiveWorkflow(false));

        const execArchBtn = document.getElementById('btn-exec-archive');
        if (execArchBtn) execArchBtn.addEventListener('click', () => executeArchiveWorkflow(false));

        const execCloseArchBtn = document.getElementById('btn-exec-close-archive');
        if (execCloseArchBtn) execCloseArchBtn.addEventListener('click', () => executeArchiveWorkflow(true));

        // 9. सहायक उपकरण (Mini-Tools) Butons
        // चर्चा पुनः खोलें
        const reopenBtn = document.getElementById('btn-tool-reopen');
        if (reopenBtn) {
            reopenBtn.addEventListener('click', () => {
                if (state.selectedIndices.size === 0) {
                    alert('कृपया पुनः खोलने हेतु कम से कम एक बंद अनुभाग चुनें।');
                    return;
                }
                const cleanVerdict = document.getElementById('chk-reopen-clean-verdict').checked;
                const cloned = state.parsedData.sections.map(s => Object.assign({}, s));
                const reopenedTitles = [];

                state.selectedIndices.forEach(idx => {
                    const s = cloned[idx];
                    if (s.isClosed) {
                        s.fullText = reopenClosedSectionWikitext(s, cleanVerdict);
                        s.isClosed = false;
                        reopenedTitles.push(s.cleanTitle);
                    }
                });

                if (reopenedTitles.length === 0) {
                    alert('चयनित अनुभागों में कोई बंद चर्चा नहीं है।');
                    return;
                }

                const newText = (state.parsedData.lead || '') + cloned.map(s => s.fullText).join('');
                showPreviewModal({
                    title: `चर्चा पुनः खोलना (${reopenedTitles.length} अनुभाग)`,
                    summary: `चर्चा पुनः सक्रिय की गई: ${reopenedTitles.join(', ')}`,
                    sourceText: newText,
                    targetPage: state.currentPageTitle
                });
            });
        }

        // पुरालेख पेटी जोड़ें
        const addBoxBtn = document.getElementById('btn-tool-addbox');
        if (addBoxBtn) {
            addBoxBtn.addEventListener('click', () => {
                if (state.parsedData.hasArchiveBox) {
                    alert('इस पृष्ठ के शीर्ष पर पहले से ही पुरालेख पेटी मौजूद है।');
                    return;
                }
                const newLead = `{{पुरालेख पेटी|auto=yes|search=yes}}\n${state.parsedData.lead || ''}`;
                const newText = newLead + state.parsedData.sections.map(s => s.fullText).join('');
                showPreviewModal({
                    title: `शीर्ष पर पुरालेख पेटी जोड़ना`,
                    summary: `रखरखाव: पृष्ठ के शीर्ष पर {{पुरालेख पेटी}} साँचा जोड़ा गया`,
                    sourceText: newText,
                    targetPage: state.currentPageTitle
                });
            });
        }

        // रिक्त अनुभाग सफ़ाई
        const cleanEmptyBtn = document.getElementById('btn-tool-cleanempty');
        if (cleanEmptyBtn) {
            cleanEmptyBtn.addEventListener('click', () => {
                const nonEmpty = state.parsedData.sections.filter(s => !s.isEmpty);
                const emptyCount = state.parsedData.sections.length - nonEmpty.length;
                if (emptyCount === 0) {
                    alert('इस पृष्ठ पर कोई भी रिक्त अनुभाग नहीं है।');
                    return;
                }
                const newText = (state.parsedData.lead || '') + nonEmpty.map(s => s.fullText).join('');
                showPreviewModal({
                    title: `रिक्त अनुभाग सफ़ाई (${emptyCount} अनुभाग)`,
                    summary: `सफ़ाई: ${emptyCount} रिक्त अनुभाग हटाए गए`,
                    sourceText: newText,
                    targetPage: state.currentPageTitle
                });
            });
        }

        // चर्चा विलोपन / काटना
        const deleteSecBtn = document.getElementById('btn-tool-deletesections');
        if (deleteSecBtn) {
            deleteSecBtn.addEventListener('click', executeDeleteSectionsWorkflow);
        }

        // चर्चा स्थानांतरण (Move Thread / Cut to another page)
        const relocateBtn = document.getElementById('btn-tool-relocate');
        if (relocateBtn) {
            relocateBtn.addEventListener('click', executeRelocateWorkflow);
        }

        // पुरालेख अनुक्रमणिका
        const makeIndexBtn = document.getElementById('btn-tool-makeindex');
        if (makeIndexBtn) {
            makeIndexBtn.addEventListener('click', () => {
                const list = state.selectedIndices.size > 0
                    ? Array.from(state.selectedIndices).map(i => state.parsedData.sections[i])
                    : state.parsedData.sections;

                const isTable = document.querySelector('input[name="index-fmt"]:checked').value === 'table';
                let out = '';

                if (isTable) {
                    out = '{| class="wikitable sortable"\n! क्र. !! चर्चा विषय !! टिप्पणियाँ !! अंतिम गतिविधि !! स्थिति !! कड़ी\n';
                    list.forEach((s, idx) => {
                        const st = s.isEmpty ? 'रिक्त' : (s.isClosed ? 'समाप्त' : 'सक्रिय');
                        out += `|-\n| ${idx + 1} || ${s.title} || ${s.commentCount} || ${s.lastDateStr} || ${st} || [[${state.currentPageTitle}#${s.cleanTitle}|चर्चा देखें]]\n`;
                    });
                    out += '|}';
                } else {
                    list.forEach(s => {
                        out += `* [[${state.currentPageTitle}#${s.cleanTitle}|${s.cleanTitle}]] (${s.commentCount} टिप्पणियाँ, अंतिम: ${s.lastDateStr})\n`;
                    });
                }

                showPreviewModal({
                    title: `पुरालेख अनुक्रमणिका (${isTable ? 'सारणी' : 'सूची'})`,
                    summary: 'पुरालेख अनुक्रमणिका क्लिपबोर्ड हेतु',
                    sourceText: out,
                    targetPage: state.currentPageTitle
                });
            });
        }

        // 11. बॉट ऑटोमेशन Butons
        const scanBotBtn = document.getElementById('btn-bot-scan');
        if (scanBotBtn) scanBotBtn.addEventListener('click', scanBotEligibleSections);
        const startBotBtn = document.getElementById('btn-bot-start');
        if (startBotBtn) startBotBtn.addEventListener('click', startBotAutomation);
        const stopBotBtn = document.getElementById('btn-bot-stop');
        if (stopBotBtn) stopBotBtn.addEventListener('click', stopBotAutomation);

        // 12. पृष्ठ लोडिंग व इनपुट
        const loadBtn = document.getElementById('load-page-btn');
        if (loadBtn) {
            loadBtn.addEventListener('click', () => {
                loadPage(document.getElementById('page-input').value);
            });
        }

        const pageInput = document.getElementById('page-input');
        if (pageInput) {
            pageInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') loadPage(pageInput.value);
            });
        }

        const presetSelect = document.getElementById('quick-preset-select');
        if (presetSelect) {
            presetSelect.addEventListener('change', (e) => {
                if (e.target.value) {
                    document.getElementById('page-input').value = e.target.value;
                    loadPage(e.target.value);
                }
            });
        }

        // 13. फ़िल्टर व चयन Butons
        const selectAllBtn = document.getElementById('btn-select-all');
        if (selectAllBtn) {
            selectAllBtn.addEventListener('click', () => {
                document.querySelectorAll('.sec-checkbox').forEach(cb => {
                    cb.checked = true;
                    state.selectedIndices.add(parseInt(cb.dataset.idx, 10));
                });
                updateSelectedCounter();
            });
        }

        const selectNoneBtn = document.getElementById('btn-select-none');
        if (selectNoneBtn) {
            selectNoneBtn.addEventListener('click', () => {
                document.querySelectorAll('.sec-checkbox').forEach(cb => {
                    cb.checked = false;
                });
                state.selectedIndices.clear();
                updateSelectedCounter();
            });
        }

        const selectClosedBtn = document.getElementById('btn-select-closed');
        if (selectClosedBtn) {
            selectClosedBtn.addEventListener('click', () => {
                document.querySelectorAll('.sec-checkbox').forEach(cb => {
                    const idx = parseInt(cb.dataset.idx, 10);
                    const isClosed = state.parsedData.sections[idx].isClosed;
                    cb.checked = isClosed;
                    if (isClosed) state.selectedIndices.add(idx);
                    else state.selectedIndices.delete(idx);
                });
                updateSelectedCounter();
            });
        }

        const selectOpenBtn = document.getElementById('btn-select-open');
        if (selectOpenBtn) {
            selectOpenBtn.addEventListener('click', () => {
                document.querySelectorAll('.sec-checkbox').forEach(cb => {
                    const idx = parseInt(cb.dataset.idx, 10);
                    const isOpen = !state.parsedData.sections[idx].isClosed && !state.parsedData.sections[idx].isEmpty;
                    cb.checked = isOpen;
                    if (isOpen) state.selectedIndices.add(idx);
                    else state.selectedIndices.delete(idx);
                });
                updateSelectedCounter();
            });
        }

        const selectEmptyBtn = document.getElementById('btn-select-empty');
        if (selectEmptyBtn) {
            selectEmptyBtn.addEventListener('click', () => {
                document.querySelectorAll('.sec-checkbox').forEach(cb => {
                    const idx = parseInt(cb.dataset.idx, 10);
                    const isEmpty = state.parsedData.sections[idx].isEmpty;
                    cb.checked = isEmpty;
                    if (isEmpty) state.selectedIndices.add(idx);
                    else state.selectedIndices.delete(idx);
                });
                updateSelectedCounter();
            });
        }

        const selectInvertBtn = document.getElementById('btn-select-invert');
        if (selectInvertBtn) {
            selectInvertBtn.addEventListener('click', () => {
                document.querySelectorAll('.sec-checkbox').forEach(cb => {
                    const idx = parseInt(cb.dataset.idx, 10);
                    cb.checked = !cb.checked;
                    if (cb.checked) state.selectedIndices.add(idx);
                    else state.selectedIndices.delete(idx);
                });
                updateSelectedCounter();
            });
        }

        const filterDays = document.getElementById('filter-inactive-days');
        if (filterDays) {
            filterDays.addEventListener('change', (e) => {
                const minDays = parseInt(e.target.value, 10);
                if (isNaN(minDays)) return;

                let count = 0;
                document.querySelectorAll('.sec-checkbox').forEach(cb => {
                    const idx = parseInt(cb.dataset.idx, 10);
                    const sec = state.parsedData.sections[idx];
                    const match = (!sec.isEmpty && sec.daysInactive >= minDays);
                    cb.checked = match;
                    if (match) {
                        state.selectedIndices.add(idx);
                        count++;
                    } else {
                        state.selectedIndices.delete(idx);
                    }
                });
                updateSelectedCounter();
                logMessage(`<b>${minDays}+ दिन</b> पुराने ${count} अनुभाग चुने गए।`, 'info');
                e.target.value = '';
            });
        }

        const filterSearch = document.getElementById('filter-search');
        if (filterSearch) {
            filterSearch.addEventListener('input', (e) => {
                const q = e.target.value.trim().toLowerCase();
                document.querySelectorAll('#sections-tbody tr').forEach(tr => {
                    const title = tr.dataset.title || '';
                    tr.style.display = (!q || title.includes(q)) ? '' : 'none';
                });
            });
        }

        // 14. टैब्स स्विचिंग
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                const target = document.getElementById(btn.dataset.tab);
                if (target) target.classList.add('active');
            });
        });

        // 15. चेकबॉक्सेस एवं चयन
        const masterCheckbox = document.getElementById('master-checkbox');
        if (masterCheckbox) {
            masterCheckbox.addEventListener('change', (e) => {
                const checked = e.target.checked;
                document.querySelectorAll('.sec-checkbox').forEach(cb => {
                    cb.checked = checked;
                    const idx = parseInt(cb.dataset.idx, 10);
                    if (checked) state.selectedIndices.add(idx);
                    else state.selectedIndices.delete(idx);
                });
                updateSelectedCounter();
            });
        }

        const tbodyEl = document.getElementById('sections-tbody');
        if (tbodyEl) {
            tbodyEl.addEventListener('change', (e) => {
                if (e.target.classList.contains('sec-checkbox')) {
                    const idx = parseInt(e.target.dataset.idx, 10);
                    if (e.target.checked) state.selectedIndices.add(idx);
                    else state.selectedIndices.delete(idx);
                    updateSelectedCounter();
                }
            });

            // त्वरित साधन Butons (तालिका के भीतर: देखना व कड़ी कॉपी)
            tbodyEl.addEventListener('click', (e) => {
                const btn = e.target.closest('button');
                if (!btn) return;

                const idx = parseInt(btn.dataset.idx, 10);
                const sec = state.parsedData.sections[idx];

                if (btn.classList.contains('view-sec-btn')) {
                    showPreviewModal({
                        title: `अनुभाग #${sec.index}: ${sec.title}`,
                        summary: `अनुभाग विकिटेक्स्ट दर्शन`,
                        sourceText: sec.fullText,
                        targetPage: state.currentPageTitle
                    });
                } else if (btn.classList.contains('copy-link-btn')) {
                    const link = `[[${state.currentPageTitle}#${sec.cleanTitle}]]`;
                    navigator.clipboard.writeText(link).then(() => {
                        logMessage(`विकि-कड़ी कॉपी की गई: <code>${link}</code>`, 'info');
                        alert(`कड़ी कॉपी हुई: ${link}`);
                    });
                }
            });
        }

        // निष्कर्ष प्रीसेट
        const verdictPresets = document.getElementById('verdict-presets');
        if (verdictPresets) {
            verdictPresets.addEventListener('change', (e) => {
                const val = e.target.value;
                if (val) {
                    const inp = document.getElementById('close-verdict');
                    inp.value = inp.value.trim() ? `${inp.value.trim()} ${val}` : val;
                    e.target.value = '';
                }
            });
        }

        const clearLogBtn = document.getElementById('btn-clear-log');
        if (clearLogBtn) {
            clearLogBtn.addEventListener('click', () => {
                document.getElementById('activity-log').innerHTML = '';
            });
        }

        // 16. सुरक्षित विकिपीडिया सत्र टोकन सत्यापन (Cryptographic Session Handshake)
        function isValidWikiSessionToken(user, token, tsStr) {
            if (!user || !token || !tsStr) return false;
            const ts = parseInt(tsStr, 10);
            if (isNaN(ts)) return false;
            // टोकन 15 मिनट (900000 मिलीसेकंड) तक मान्य है
            const now = Date.now();
            if (Math.abs(now - ts) > 900000) {
                console.warn('Session token expired');
                return false;
            }
            try {
                const expected = btoa(unescape(encodeURIComponent(user + ':' + ts)));
                return token === expected;
            } catch (e) {
                return false;
            }
        }

        // प्रारंभिक URL पैरामीटर्स, OAuth एवं सुरक्षित इन-विकि सत्र लॉगिन
        const urlParams = new URLSearchParams(window.location.search);
        const queryPage = urlParams.get('page');
        const queryUser = urlParams.get('user');
        const queryToken = urlParams.get('token');
        const queryTs = urlParams.get('ts');
        const initialTarget = queryPage || 'विकिपीडिया:चौपाल';
        const pageInp = document.getElementById('page-input');
        if (pageInp) pageInp.value = initialTarget;

        // पहले विकिमीडिया OAuth 2.0 रीडायरेक्ट कॉलबैक जाँचें
        handleOAuthCallback().then(isOAuthLogged => {
            if (isOAuthLogged) {
                loadPage(initialTarget);
                return;
            }

            // यदि URL में सदस्य नाम दिया गया है तो टोकन का कड़ा सत्यापन अनिवार्य है
            if (queryUser) {
                if (isValidWikiSessionToken(queryUser, queryToken, queryTs)) {
                    // वैध टोकन: विकिपीडिया के अंदर सक्रिय सत्र से खुला है
                    window.history.replaceState({}, document.title, window.location.pathname + (queryPage ? '?page=' + encodeURIComponent(queryPage) : ''));
                    checkUserEligibility(queryUser).then(res => {
                        if (res && res.exists && res.isAutoconfirmed) {
                            state.auth = Object.assign(state.auth, res, { isLoggedIn: true, verified: true });
                            localStorage.setItem('da_wiki_user', res.username);
                            localStorage.setItem('da_username', res.username);
                            localStorage.setItem('da_auth_verified', '1');
                            updateAccessControlUI(state.auth);
                            logMessage(`सुरक्षित विकिपीडिया सत्र सत्यापित: <b>${escapeHtml(res.username)}</b>। उपकरण अनलॉक हो गया है।`, 'success');
                            loadPage(initialTarget);
                        } else {
                            updateAccessControlUI(state.auth);
                            logMessage(`खाता '${escapeHtml(queryUser)}' स्वतः स्थापित अर्हता पूरी नहीं करता।`, 'warning');
                        }
                    }).catch(() => {
                        updateAccessControlUI(state.auth);
                    });
                } else {
                    // अवैध अथवा अनाधिकृत टोकन (प्रतिरूपण का प्रयास)
                    logMessage(`⚠️ सुरक्षा चेतावनी: सदस्य '${escapeHtml(queryUser)}' का अनाधिकृत टोकन अस्वीकृत। प्रतिरूपण वर्जित है।`, 'error');
                    alert(`⚠️ सुरक्षा चेतावनी: अनाधिकृत प्रवेश अस्वीकृत!\nआप किसी अन्य सदस्य का नाम लिखकर उनके खाते का प्रतिरूपण नहीं कर सकते।\nकृपया विकिपीडिया में अपने खाते से लॉगिन करके '📚 चर्चा समापन' टैब से टूल खोलें।`);
                    window.history.replaceState({}, document.title, window.location.pathname + (queryPage ? '?page=' + encodeURIComponent(queryPage) : ''));
                    updateAccessControlUI(state.auth);
                }
            } else if (state.auth.username && localStorage.getItem('da_auth_verified') === '1') {
                // पहले से इस डिवाइस में सुरक्षित सत्यापित सत्र
                checkUserEligibility(state.auth.username).then(res => {
                    if (res && res.exists && res.isAutoconfirmed) {
                        state.auth = Object.assign(state.auth, res, { isLoggedIn: true, verified: true });
                        updateAccessControlUI(state.auth);
                        loadPage(initialTarget);
                    } else {
                        updateAccessControlUI(state.auth);
                    }
                }).catch(() => {
                    updateAccessControlUI(state.auth);
                });
            } else {
                updateAccessControlUI(state.auth);
            }
        });
    });

})();
