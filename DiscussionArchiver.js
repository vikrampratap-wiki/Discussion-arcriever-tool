/**
 * हिन्दी विकिपीडिया चर्चा समापन एवं पुरालेखण उपकरण (Discussion Archiver User Script)
 * लेखक: सदस्य:विक्रम प्रताप
 * रिपॉजिटरी: https://github.com/vikrampratap-wiki/Discussion-arcriever-tool
 * वेब उपकरण: https://vikrampratap-wiki.github.io/Discussion-arcriever-tool/
 * 
 * संस्थापन निर्देश:
 * अपने विकिपीडिया सदस्य पृष्ठ के common.js (Special:MyPage/common.js) में निम्न पंक्ति जोड़ें:
 * mw.loader.load('https://vikrampratap-wiki.github.io/Discussion-arcriever-tool/DiscussionArchiver.js');
 */

(function () {
    'use strict';

    // MediaWiki कोर उपयोगिताओं (mediawiki.util, mediawiki.api) के लोड होने की प्रतीक्षा करें
    mw.loader.using(['mediawiki.util', 'mediawiki.api']).then(function () {
        var pageName = mw.config.get('wgPageName');
        var userName = mw.config.get('wgUserName');

        // उपकरण का बेस यूआरएल
        var toolBaseUrl = 'https://vikrampratap-wiki.github.io/Discussion-arcriever-tool/';
        var toolUrl = toolBaseUrl + '?page=' + encodeURIComponent(pageName || 'विकिपीडिया:चौपाल') + 
            (userName ? '&user=' + encodeURIComponent(userName) : '');

        // 1. शीर्ष टैब (Views / Page Actions - 'संपादित करें' व 'इतिहास देखें' के बगल में)
        // यह Vector 2022 और लेगेसी Vector दोनों में सबसे ऊपर साफ़ दिखता है
        var topTab = mw.util.addPortletLink(
            'p-views',
            toolUrl,
            '📚 चर्चा समापन',
            'ca-discussion-archiver',
            'इस पृष्ठ की चर्चाओं को समाप्त या पुरालेख में स्थानांतरित करें'
        );

        // यदि p-views उपलब्ध न हो (उदा: अधिक / More मेनू p-cactions)
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

        // 2. साइडबार के 'उपकरण' (Tools / p-tb) मेनू में भी जोड़ें
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

        console.log('✅ हिन्दी विकिपीडिया चर्चा समापन एवं पुरालेखण उपकरण (DiscussionArchiver.js) सफलतापूर्वक लोड हुआ। सदस्य:', userName);
    }).catch(function (err) {
        console.error('DiscussionArchiver.js लोड करने में त्रुटि:', err);
    });

})();
