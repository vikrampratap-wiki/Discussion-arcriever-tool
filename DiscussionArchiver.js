/**
 * हिन्दी विकिपीडिया चर्चा समापन एवं पुरालेखण उपकरण (Discussion Archiver User Script)
 * लेखक: सदस्य:विक्रम प्रताप
 * रिपॉजिटरी: https://github.com/vikrampratap-wiki/Discussion-arcriever-tool
 * वेब उपकरण: https://vikrampratap-wiki.github.io/Discussion-arcriever-tool/
 * 
 * स्थापना निर्देश (Installation):
 * अपने विकिपीडिया सदस्य पृष्ठ के common.js (Special:MyPage/common.js) में निम्न पंक्ति जोड़ें:
 * mw.loader.load('https://vikrampratap-wiki.github.io/Discussion-arcriever-tool/DiscussionArchiver.js');
 */

(function () {
    'use strict';

    // 1. त्वरित प्रमाणीकरण ब्रिज (Auth Bridge for Web Tool)
    if (window.opener && window.location.search.indexOf('da_auth=1') !== -1) {
        var authUser = mw.config.get('wgUserName');
        if (authUser) {
            window.opener.postMessage({ type: 'WIKI_AUTH_SUCCESS', username: authUser }, '*');
            setTimeout(function () { window.close(); }, 400);
            return;
        }
    }

    // केवल चर्चा/वार्ता पृष्ठों और विकिपीडिया नामस्थान पर लोड करें
    var ns = mw.config.get('wgNamespaceNumber');
    if (ns % 2 !== 1 && ns !== 4) {
        return;
    }

    $(function () {
        var pageName = mw.config.get('wgPageName');
        var userName = mw.config.get('wgUserName') || '';
        var toolUrl = 'https://vikrampratap-wiki.github.io/Discussion-arcriever-tool/?page=' + 
            encodeURIComponent(pageName) + 
            (userName ? '&user=' + encodeURIComponent(userName) : '');

        // साइडबार के 'उपकरण' (Tools) मेनू में लिंक जोड़ें
        var portletLink = mw.util.addPortletLink(
            'p-tb',
            toolUrl,
            '📚 चर्चा समापन व पुरालेखण',
            't-discussion-archiver',
            'इस पृष्ठ की चर्चाओं को समाप्त या पुरालेख में स्थानांतरित करें'
        );

        if (portletLink) {
            $(portletLink).find('a').attr('target', '_blank');
        }
    });
})();
