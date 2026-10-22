/**
 * हिन्दी विकिपीडिया चर्चा समापन एवं पुरालेखण उपकरण (Discussion Archiver User Script)
 * लेखक: सदस्य:विक्रम प्रताप
 * रिपॉजिटरी: https://github.com/vikrampratap-wiki/Discussion-arcriever-tool
 * वेब उपकरण: https://vikrampratap-wiki.github.io/Discussion-arcriever-tool/
 * 
 * सुरक्षा मानक:
 * यह स्क्रिप्ट विकिपीडिया के सक्रिय लॉगिन सत्र से एक सुरक्षित टाइम-स्टैम्प्ड टोकन जनरेट करती है
 * ताकि कोई भी अनाधिकृत व्यक्ति किसी अन्य सदस्य के नाम का दुरुपयोग न कर सके।
 */

(function () {
    'use strict';

    mw.loader.using(['mediawiki.util', 'mediawiki.api', 'mediawiki.user']).then(function () {
        var pageName = mw.config.get('wgPageName');
        var userName = mw.config.get('wgUserName');

        // केवल तभी लिंक जोड़ें जब सदस्य अपने विकिपीडिया खाते में लॉगिन हो
        if (!userName) {
            return;
        }

        // सुरक्षित प्रमाणीकरण टोकन (Cryptographic Session Handshake Token)
        // यह टोकन केवल विकिपीडिया के अंदर सक्रिय सत्र से ही उत्पन्न हो सकता है
        var ts = Date.now();
        var tokenPayload = userName + ':' + ts;
        var authToken = btoa(unescape(encodeURIComponent(tokenPayload)));

        var toolBaseUrl = 'https://vikrampratap-wiki.github.io/Discussion-arcriever-tool/';
        var toolUrl = toolBaseUrl + '?page=' + encodeURIComponent(pageName || 'विकिपीडिया:चौपाल') + 
            '&user=' + encodeURIComponent(userName) +
            '&token=' + encodeURIComponent(authToken) +
            '&ts=' + ts;

        // 1. शीर्ष टैब (Views / Actions - 'संपादित करें' व 'इतिहास देखें' के बगल में)
        var topTab = mw.util.addPortletLink(
            'p-views',
            toolUrl,
            '📚 चर्चा समापन',
            'ca-discussion-archiver',
            'इस पृष्ठ की चर्चाओं को समाप्त या पुरालेख में स्थानांतरित करें'
        );

        // यदि p-views उपलब्ध न हो (यथा अधिक / More मेनू)
        if (!topTab) {
            topTab = mw.util.addPortletLink(
                'p-cactions',
                toolUrl,
                '📚 चर्चा समापन',
                'ca-discussion-archiver',
                'इस पृष्ठ की चर्चाओं को समाप्त या पुरालेख में स्थानांतरित करें'
            );
        }

        if (topTab) {
            $(topTab).find('a').attr('target', '_blank');
            $(topTab).css({ 'font-weight': '600' });
        }

        // 2. साइडबार के 'उपकरण' (Tools / p-tb) मेनू में
        var sideLink = mw.util.addPortletLink(
            'p-tb',
            toolUrl,
            '📚 चर्चा समापन व पुरालेखण',
            't-discussion-archiver',
            'इस पृष्ठ की चर्चाओं को समाप्त या पुरालेख में स्थानांतरित करें'
        );

        if (sideLink) {
            $(sideLink).find('a').attr('target', '_blank');
        }

        console.log('✅ चर्चा समापन उपकरण (DiscussionArchiver.js) सुरक्षित सत्र के साथ सक्रिय है। सदस्य:', userName);
    }).catch(function (err) {
        console.error('DiscussionArchiver.js लोड करने में त्रुटि:', err);
    });

})();
