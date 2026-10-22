/**
 * हिन्दी विकिपीडिया चर्चा समापन एवं पुरालेखण उपकरण (Discussion Archiver User Script)
 * लेखक: सदस्य:विक्रम प्रताप
 * रिपॉजिटरी: https://github.com/vikrampratap-wiki/Discussion-arcriever-tool
 * वेब उपकरण: https://vikrampratap-wiki.github.io/Discussion-arcriever-tool/
 */

(function () {
    'use strict';

    mw.loader.using(['mediawiki.util', 'mediawiki.api', 'mediawiki.user']).then(function () {
        var pageName = mw.config.get('wgPageName');
        var userName = mw.config.get('wgUserName');

        // केवल तभी सक्रिय करें जब सदस्य अपने विकिपीडिया खाते में लॉगिन हो
        if (!userName) {
            console.log('DiscussionArchiver: सदस्य लॉगिन नहीं है।');
            return;
        }

        // सुरक्षित टाइम-स्टैम्प्ड सत्र टोकन
        var ts = Date.now();
        var tokenPayload = userName + ':' + ts;
        var authToken = btoa(unescape(encodeURIComponent(tokenPayload)));

        var toolBaseUrl = 'https://vikrampratap-wiki.github.io/Discussion-arcriever-tool/';
        var toolUrl = toolBaseUrl + '?page=' + encodeURIComponent(pageName || 'विकिपीडिया:चौपाल') + 
            '&user=' + encodeURIComponent(userName) +
            '&token=' + encodeURIComponent(authToken) +
            '&ts=' + ts;

        // 1. प्राथमिक: पृष्ठ के मुख्य शीर्षक (#firstHeading) के बगल में स्पष्ट बटन
        // यह Vector 2022, Legacy Vector, Timeless और मोबाइल सबमें हमेशा सामने दिखता है
        function addHeadingButton() {
            var $heading = $('#firstHeading');
            if ($heading.length && !$('#firstheading-da-btn').length) {
                var $btn = $('<a>')
                    .attr('id', 'firstheading-da-btn')
                    .attr('href', toolUrl)
                    .attr('target', '_blank')
                    .attr('title', 'इस पृष्ठ की चर्चाओं को समाप्त या पुरालेख में स्थानांतरित करें')
                    .text('📚 चर्चा समापन')
                    .css({
                        'font-size': '13px',
                        'font-weight': '600',
                        'margin-left': '12px',
                        'vertical-align': 'middle',
                        'padding': '3px 10px',
                        'background-color': '#f8f9fa',
                        'color': '#202122',
                        'border': '1px solid #a2a9b1',
                        'border-radius': '4px',
                        'text-decoration': 'none',
                        'display': 'inline-block'
                    })
                    .hover(
                        function () { $(this).css({ 'background-color': '#eaf3ff', 'color': '#36c', 'border-color': '#36c' }); },
                        function () { $(this).css({ 'background-color': '#f8f9fa', 'color': '#202122', 'border-color': '#a2a9b1' }); }
                    );

                $heading.append($btn);
            }
        }

        // DOM तैयार होने पर हेडिंग बटन जोड़ें
        $(addHeadingButton);

        // 2. मानक शीर्ष टैब (p-views / p-cactions 'अधिक' मेनू)
        var topTab = mw.util.addPortletLink(
            'p-views',
            toolUrl,
            '📚 चर्चा समापन',
            'ca-discussion-archiver',
            'इस पृष्ठ की चर्चाओं को समाप्त या पुरालेख में स्थानांतरित करें'
        );

        // Vector 2022 में 'अधिक' (p-cactions) ड्रॉपडाउन मेनू में भी जोड़ें
        var moreTab = mw.util.addPortletLink(
            'p-cactions',
            toolUrl,
            '📚 चर्चा समापन उपकरण',
            'ca-discussion-archiver-more',
            'इस पृष्ठ की चर्चाओं को समाप्त या पुरालेख में स्थानांतरित करें'
        );

        if (topTab) $(topTab).find('a').attr('target', '_blank');
        if (moreTab) $(moreTab).find('a').attr('target', '_blank');

        // 3. साइडबार के 'उपकरण' (Tools / p-tb) मेनू में
        var sideLink = mw.util.addPortletLink(
            'p-tb',
            toolUrl,
            '📚 चर्चा समापन व पुरालेखण',
            't-discussion-archiver',
            'इस पृष्ठ की चर्चाओं को समाप्त या पुरालेख में स्थानांतरित करें'
        );

        if (sideLink) $(sideLink).find('a').attr('target', '_blank');

        console.log('✅ चर्चा समापन उपकरण (DiscussionArchiver.js v4.0) सफलतापूर्वक सक्रिय। सदस्य:', userName);
    }).catch(function (err) {
        console.error('DiscussionArchiver.js लोड करने में त्रुटि:', err);
    });

})();
