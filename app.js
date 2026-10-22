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
            username: localStorage.getItem('da_username') || '',
            botPassword: localStorage.getItem('da_botpass') || '',
            isLoggedIn: false,
            isAutoconfirmed: false,
            isBot: false,
            isSysop: false,
            editCount: 0,
            daysOld: 0,
            groups: [],
            verified: false
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
        body = body.replace(/\{\{\s*(?:चर्चा[_ ]शीर्ष|Archive[_ ]top|Atop|Cot|Hat|Discussion[_ ]top)(?:\|[^\}]*)?\}\}\s*\n?/gi, '');
        body = body.replace(/\n?\s*\{\{\s*(?:चर्चा[_ ]तल|Archive[_ ]bottom|Abot|Cob|Hab|Discussion[_ ]bottom)\s*\}\}\s*\n?/gi, '');
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

    async function fetchWikipediaAPI(params) {
        params.format = 'json';
        params.origin = '*'; // CORS support

        const queryStr = Object.keys(params)
            .map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`)
            .join('&');
        const url = `${WIKI_API}?${queryStr}`;

        const resp = await fetch(url);
        if (!resp.ok) {
            throw new Error(`HTTP Error ${resp.status}: ${resp.statusText}`);
        }
        return await resp.json();
    }

    // विकिमीडिया सेंट्रलऑथ (CentralAuth SUL) वैश्विक खाता विवरण
    async function fetchCentralAuthInfo(username) {
        if (!username) return null;
        const cleanName = username.trim().replace(/^सदस्य:/i, '').replace(/^User:/i, '');
        const metaUrl = `https://meta.wikimedia.org/w/api.php?action=query&meta=globaluserinfo&guiuser=${encodeURIComponent(cleanName)}&guiprop=groups|rights|merged|editcount&format=json&origin=*`;

        try {
            const resp = await fetch(metaUrl);
            if (!resp.ok) return null;
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

    // सदस्य न्यूनतम पात्रता एवं सेंट्रलऑथ सत्यापन
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
            if (!user || user.missing !== undefined) {
                return { exists: false, username: cleanName, message: 'यह सदस्य नाम हिन्दी विकिपीडिया पर नहीं मिला।' };
            }

            const groups = user.groups || [];
            const rights = user.rights || [];
            const editCount = user.editcount || 0;
            const regDate = user.registration ? new Date(user.registration) : new Date(0);
            const daysOld = user.registration ? Math.max(0, Math.floor((Date.now() - regDate.getTime()) / (1000 * 60 * 60 * 24))) : 999;

            const hasGroup = groups.includes('autoconfirmed') || groups.includes('sysop') || groups.includes('bot') || groups.includes('rollbacker') || groups.includes('patroller');
            const hasRight = rights.includes('autoconfirmed');
            const meetsThreshold = (daysOld >= 4 && editCount >= 10);
            const isAutoconfirmed = hasGroup || hasRight || meetsThreshold;

            const isBot = groups.includes('bot') || cleanName.toLowerCase().endsWith('bot');
            const isSysop = groups.includes('sysop');

            return {
                exists: true,
                userid: user.userid,
                username: cleanName,
                groups: groups,
                editCount: editCount,
                registration: user.registration || '',
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

    function updateAuthBadgeUI(info) {
        const pill = document.getElementById('logged-user-pill');
        const loginBtn = document.getElementById('btn-open-login');

        if (!info || !info.isAutoconfirmed) {
            pill.style.display = 'none';
            loginBtn.style.display = 'inline-flex';
            return;
        }

        // यदि सत्यापित है:
        loginBtn.style.display = 'none';
        pill.style.display = 'inline-flex';
        document.getElementById('logged-user-name').textContent = info.username;
        document.getElementById('user-avatar-initial').textContent = info.username[0] || 'व';

        const badgeEl = document.getElementById('logged-user-badge');
        if (info.isBot) {
            badgeEl.className = 'badge-bot';
            badgeEl.textContent = '🤖 बॉट';
        } else if (info.isSysop) {
            badgeEl.className = 'badge-sysop';
            badgeEl.textContent = '🛡️ प्रबंधक';
        } else if (info.central && info.central.isUnified) {
            badgeEl.className = 'badge-sul';
            badgeEl.textContent = '🌐 सेंट्रल SUL';
        } else {
            badgeEl.className = 'badge-autoconfirmed';
            badgeEl.textContent = '✓ स्वतःस्थापित';
        }
    }

    function openLoginModal(tabId = 'ltab-login') {
        document.querySelectorAll('.login-tab-pane').forEach(p => p.style.display = 'none');
        document.querySelectorAll('[data-ltab]').forEach(b => b.classList.remove('active'));

        const targetPane = document.getElementById(tabId);
        const targetBtn = document.querySelector(`[data-ltab="${tabId}"]`);
        if (targetPane) targetPane.style.display = 'block';
        if (targetBtn) targetBtn.classList.add('active');

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

        if (opts.archiveText) {
            previewArchive.value = opts.archiveText;
            modalTabs.style.display = 'flex';
        } else {
            modalTabs.style.display = 'none';
            pSourcePane.style.display = 'block';
            pArchivePane.style.display = 'none';
        }

        const wikiEditBtn = document.getElementById('btn-open-wiki-edit');
        wikiEditBtn.href = `https://hi.wikipedia.org/w/index.php?title=${encodeURIComponent(opts.targetPage)}&action=edit`;

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
        // थीम आरंभ
        document.documentElement.setAttribute('data-theme', state.theme);

        document.getElementById('theme-toggle-btn').addEventListener('click', () => {
            state.theme = state.theme === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', state.theme);
            localStorage.setItem('da_theme', state.theme);
        });

        // प्रमाणीकरण व पात्रता आरंभ
        updateAuthBadgeUI(state.auth);

        // लॉगिन मोडल खोलना / बंद करना
        document.getElementById('btn-open-login').addEventListener('click', () => openLoginModal('ltab-login'));
        document.getElementById('btn-verify-eligibility-quick').addEventListener('click', () => openLoginModal('ltab-verify'));
        document.getElementById('btn-close-login-modal').addEventListener('click', () => {
            document.getElementById('login-modal').style.display = 'none';
        });
        document.getElementById('btn-dismiss-login-modal').addEventListener('click', () => {
            document.getElementById('login-modal').style.display = 'none';
        });

        // लॉगिन मोडल सब-टैब्स
        document.querySelectorAll('[data-ltab]').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.login-tab-pane').forEach(p => p.style.display = 'none');
                document.querySelectorAll('[data-ltab]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(btn.dataset.ltab).style.display = 'block';
            });
        });

        // पात्रता सत्यापन बटन
        document.getElementById('btn-check-user-eligibility').addEventListener('click', async () => {
            const uInput = document.getElementById('verify-username-input').value.trim();
            if (!uInput) return;

            const resBox = document.getElementById('verification-result-box');
            resBox.style.display = 'block';
            resBox.innerHTML = '<span class="text-muted">विकिपीडिया से जानकारी ली जा रही है...</span>';

            const res = await checkUserEligibility(uInput);
            if (!res || !res.exists) {
                resBox.innerHTML = `<span class="text-danger font-bold">❌ त्रुटि:</span> ${res ? res.message || res.error : 'सदस्य उपलब्ध नहीं है।'}`;
                return;
            }

            const autoconfirmedTag = res.isAutoconfirmed
                ? '<span class="badge-autoconfirmed">✅ स्वतः स्थापित (पात्र)</span>'
                : '<span class="badge-restricted">❌ अपात्र</span>';

            const globalEdits = res.central ? res.central.globalEditCount.toLocaleString('hi-IN') : '—';
            const homeWiki = res.central && res.central.home ? res.central.home : 'hiwiki';
            const sulLink = `https://meta.wikimedia.org/wiki/Special:CentralAuth/${encodeURIComponent(res.username)}`;

            resBox.innerHTML = `
                <div class="central-auth-card">
                    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; flex-wrap:wrap; gap:8px;">
                        <div style="display:flex; align-items:center; gap:8px;">
                            <span class="user-avatar" style="width:28px; height:28px; font-size:13px;">${res.username[0] || 'व'}</span>
                            <div>
                                <strong>${escapeHtml(res.username)}</strong>
                                ${res.central ? '<span class="badge-sul" style="margin-left:4px;">🌐 SUL Unified</span>' : ''}
                            </div>
                        </div>
                        ${autoconfirmedTag}
                    </div>
                    <div class="metric-grid">
                        <div class="metric-box">
                            <div class="metric-val">${res.editCount.toLocaleString('hi-IN')}</div>
                            <div class="metric-lbl">🇮🇳 हिन्दी संपादन</div>
                        </div>
                        <div class="metric-box">
                            <div class="metric-val">${globalEdits}</div>
                            <div class="metric-lbl">🌍 वैश्विक संपादन (SUL)</div>
                        </div>
                        <div class="metric-box">
                            <div class="metric-val">${homeWiki}</div>
                            <div class="metric-lbl">🏠 मूल विकि</div>
                        </div>
                    </div>
                    <div style="margin-top:10px; display:flex; justify-content:space-between; align-items:center; font-size:12px; flex-wrap:wrap; gap:8px;">
                        <span class="text-muted">खाता आयु: <strong>${res.daysOld} दिन</strong> (${res.registration ? res.registration.split('T')[0] : '—'})</span>
                        <a href="${sulLink}" target="_blank" class="link-btn">सेंट्रलऑथ प्रोफ़ाइल (Meta) ↗</a>
                    </div>
                    ${res.isAutoconfirmed ? `
                    <div style="margin-top:10px; padding-top:8px; border-top:1px dashed var(--border-color); text-align:right;">
                        <button type="button" id="btn-use-this-user" class="btn btn-primary btn-sm">
                            ✓ इस खाते से उपकरण प्रारंभ करें
                        </button>
                    </div>` : ''}
                </div>
            `;

            if (res.isAutoconfirmed) {
                state.auth = Object.assign(state.auth, res);
                updateAuthBadgeUI(state.auth);
                localStorage.setItem('da_username', res.username);

                const useBtn = document.getElementById('btn-use-this-user');
                if (useBtn) {
                    useBtn.addEventListener('click', () => {
                        document.getElementById('login-modal').style.display = 'none';
                        logMessage(`सेंट्रलऑथ लॉगिन: <b>${res.username}</b> सक्रिय हुआ।`, 'success');
                    });
                }
            }
        });

        // लॉगिन बटन
        document.getElementById('btn-do-login').addEventListener('click', async () => {
            const uName = document.getElementById('login-username').value.trim();
            const uPass = document.getElementById('login-password').value.trim();
            const feedback = document.getElementById('login-feedback');

            if (!uName) {
                alert('कृपया सदस्य नाम दर्ज करें।');
                return;
            }

            feedback.style.display = 'block';
            feedback.className = 'security-box';
            feedback.innerHTML = 'सदस्य जानकारी व पात्रता जाँची जा रही है...';

            const userCheck = await checkUserEligibility(uName);
            if (!userCheck || !userCheck.exists) {
                feedback.className = 'security-box danger';
                feedback.innerHTML = `❌ सदस्य '${uName}' विकिपीडिया पर नहीं मिला।`;
                return;
            }

            if (!userCheck.isAutoconfirmed) {
                feedback.className = 'security-box danger';
                feedback.innerHTML = `⚠️ <strong>अपात्र:</strong> यह खाता न्यूनतम 'स्वतः स्थापित सदस्य' नहीं है। चर्चा समापन हेतु 4 दिन पुराना खाता और 10+ संपादन अनिवार्य हैं।`;
                return;
            }

            state.auth = Object.assign(state.auth, userCheck, {
                botPassword: uPass,
                isLoggedIn: true
            });

            if (document.getElementById('chk-remember-login').checked) {
                localStorage.setItem('da_username', uName);
                if (uPass) localStorage.setItem('da_botpass', uPass);
            }

            updateAuthBadgeUI(state.auth);
            feedback.className = 'security-box success';
            feedback.innerHTML = `✓ बधाई! सदस्य <strong>${uName}</strong> सफलतापूर्वक सत्यापित एवं लॉगिन हो गए हैं।`;
            logMessage(`सदस्य <strong>${uName}</strong> लॉगिन व पात्रता सत्यापित।`, 'success');

            setTimeout(() => {
                document.getElementById('login-modal').style.display = 'none';
            }, 1200);
        });

        // लॉगआउट बटन
        document.getElementById('btn-logout').addEventListener('click', () => {
            localStorage.removeItem('da_username');
            localStorage.removeItem('da_botpass');
            state.auth.isAutoconfirmed = false;
            state.auth.isLoggedIn = false;
            state.auth.username = '';
            updateAuthBadgeUI(null);
            logMessage('सत्र समाप्त (लॉगआउट)।', 'info');
        });

        // सदस्य बदलें बटन (अन्य सदस्यों हेतु)
        const switchUserBtn = document.getElementById('btn-switch-user');
        if (switchUserBtn) {
            switchUserBtn.addEventListener('click', () => openLoginModal('ltab-verify'));
        }

        // एकल फ़ाइल डाउनलोड बटन्स
        document.getElementById('btn-download-standalone').addEventListener('click', downloadStandaloneBundle);
        document.getElementById('btn-download-standalone-footer').addEventListener('click', downloadStandaloneBundle);

        // बॉट ऑटोमेशन बटन्स
        document.getElementById('btn-bot-scan').addEventListener('click', scanBotEligibleSections);
        document.getElementById('btn-bot-start').addEventListener('click', startBotAutomation);
        document.getElementById('btn-bot-stop').addEventListener('click', stopBotAutomation);

        // पृष्ठ लोडिंग
        document.getElementById('load-page-btn').addEventListener('click', () => {
            loadPage(document.getElementById('page-input').value);
        });

        document.getElementById('page-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') loadPage(document.getElementById('page-input').value);
        });

        document.getElementById('quick-preset-select').addEventListener('change', (e) => {
            if (e.target.value) {
                document.getElementById('page-input').value = e.target.value;
                loadPage(e.target.value);
            }
        });

        // निष्कर्ष प्रीसेट
        document.getElementById('verdict-presets').addEventListener('change', (e) => {
            const val = e.target.value;
            if (val) {
                const inp = document.getElementById('close-verdict');
                inp.value = inp.value.trim() ? `${inp.value.trim()} ${val}` : val;
                e.target.value = '';
            }
        });

        // चेकबॉक्सेस एवं चयन
        document.getElementById('master-checkbox').addEventListener('change', (e) => {
            const checked = e.target.checked;
            document.querySelectorAll('.sec-checkbox').forEach(cb => {
                cb.checked = checked;
                const idx = parseInt(cb.dataset.idx, 10);
                if (checked) state.selectedIndices.add(idx);
                else state.selectedIndices.delete(idx);
            });
            updateSelectedCounter();
        });

        document.getElementById('sections-tbody').addEventListener('change', (e) => {
            if (e.target.classList.contains('sec-checkbox')) {
                const idx = parseInt(e.target.dataset.idx, 10);
                if (e.target.checked) state.selectedIndices.add(idx);
                else state.selectedIndices.delete(idx);
                updateSelectedCounter();
            }
        });

        // त्वरित साधन बटन (तालिका के भीतर)
        document.getElementById('sections-tbody').addEventListener('click', (e) => {
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

        // फ़िल्टर बटन्स
        document.getElementById('btn-select-all').addEventListener('click', () => {
            document.querySelectorAll('#sections-tbody tr:not([style*="display: none"]) .sec-checkbox').forEach(cb => {
                cb.checked = true;
                state.selectedIndices.add(parseInt(cb.dataset.idx, 10));
            });
            updateSelectedCounter();
        });

        document.getElementById('btn-select-none').addEventListener('click', () => {
            document.querySelectorAll('.sec-checkbox').forEach(cb => cb.checked = false);
            state.selectedIndices.clear();
            updateSelectedCounter();
        });

        document.getElementById('btn-select-closed').addEventListener('click', () => {
            document.querySelectorAll('.sec-checkbox').forEach(cb => {
                const idx = parseInt(cb.dataset.idx, 10);
                const isClosed = state.parsedData.sections[idx].isClosed;
                cb.checked = isClosed;
                if (isClosed) state.selectedIndices.add(idx);
                else state.selectedIndices.delete(idx);
            });
            updateSelectedCounter();
        });

        document.getElementById('btn-select-open').addEventListener('click', () => {
            document.querySelectorAll('.sec-checkbox').forEach(cb => {
                const idx = parseInt(cb.dataset.idx, 10);
                const isOpen = !state.parsedData.sections[idx].isClosed && !state.parsedData.sections[idx].isEmpty;
                cb.checked = isOpen;
                if (isOpen) state.selectedIndices.add(idx);
                else state.selectedIndices.delete(idx);
            });
            updateSelectedCounter();
        });

        document.getElementById('btn-select-empty').addEventListener('click', () => {
            document.querySelectorAll('.sec-checkbox').forEach(cb => {
                const idx = parseInt(cb.dataset.idx, 10);
                const isEmpty = state.parsedData.sections[idx].isEmpty;
                cb.checked = isEmpty;
                if (isEmpty) state.selectedIndices.add(idx);
                else state.selectedIndices.delete(idx);
            });
            updateSelectedCounter();
        });

        document.getElementById('btn-select-invert').addEventListener('click', () => {
            document.querySelectorAll('.sec-checkbox').forEach(cb => {
                const idx = parseInt(cb.dataset.idx, 10);
                cb.checked = !cb.checked;
                if (cb.checked) state.selectedIndices.add(idx);
                else state.selectedIndices.delete(idx);
            });
            updateSelectedCounter();
        });

        document.getElementById('filter-inactive-days').addEventListener('change', (e) => {
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

        // रीयल-टाइम खोज फ़िल्टर
        document.getElementById('filter-search').addEventListener('input', (e) => {
            const q = e.target.value.trim().toLowerCase();
            document.querySelectorAll('#sections-tbody tr').forEach(tr => {
                const title = tr.dataset.title || '';
                tr.style.display = (!q || title.includes(q)) ? '' : 'none';
            });
        });

        // टैब्स स्विचिंग
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(btn.dataset.tab).classList.add('active');
            });
        });

        // मोडल टैब्स
        document.querySelectorAll('.preview-tab-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.preview-tab-btn').forEach(b => b.classList.remove('active'));
                document.querySelectorAll('.preview-tab-pane').forEach(p => p.style.display = 'none');
                btn.classList.add('active');
                document.getElementById(btn.dataset.ptab).style.display = 'block';
            });
        });

        // मोडल बंद करना
        document.getElementById('btn-close-modal').addEventListener('click', () => {
            document.getElementById('preview-modal').style.display = 'none';
        });

        // क्रियान्वयन बटन्स
        document.getElementById('btn-preview-close').addEventListener('click', executeClosePreview);
        document.getElementById('btn-exec-close').addEventListener('click', executeClosePreview);

        document.getElementById('btn-check-archives').addEventListener('click', () => {
            checkExistingArchives(state.currentPageTitle);
        });

        document.getElementById('btn-preview-archive').addEventListener('click', () => executeArchiveWorkflow(false));
        document.getElementById('btn-exec-archive').addEventListener('click', () => executeArchiveWorkflow(false));
        document.getElementById('btn-exec-close-archive').addEventListener('click', () => executeArchiveWorkflow(true));

        // सहायक उपकरण
        document.getElementById('btn-tool-reopen').addEventListener('click', () => {
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

        document.getElementById('btn-tool-addbox').addEventListener('click', () => {
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

        document.getElementById('btn-tool-cleanempty').addEventListener('click', () => {
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

        document.getElementById('btn-tool-makeindex').addEventListener('click', () => {
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

        document.getElementById('btn-clear-log').addEventListener('click', () => {
            document.getElementById('activity-log').innerHTML = '';
        });

        // प्रारंभिक URL पैरामीटर्स एवं सदस्य सत्यापन (?page=...&user=...)
        const urlParams = new URLSearchParams(window.location.search);
        const queryPage = urlParams.get('page');
        const queryUser = urlParams.get('user');

        if (queryUser) {
            checkUserEligibility(queryUser).then(res => {
                if (res && res.isAutoconfirmed) {
                    state.auth = Object.assign(state.auth, res, { isLoggedIn: true });
                    localStorage.setItem('da_username', res.username);
                    updateAuthBadgeUI(state.auth);
                }
            });
        } else if (state.auth.username) {
            checkUserEligibility(state.auth.username).then(res => {
                if (res && res.isAutoconfirmed) {
                    state.auth = Object.assign(state.auth, res);
                    updateAuthBadgeUI(state.auth);
                }
            });
        }

        const initialTarget = queryPage || 'विकिपीडिया:चौपाल';
        document.getElementById('page-input').value = initialTarget;
        loadPage(initialTarget);
    });

})();
