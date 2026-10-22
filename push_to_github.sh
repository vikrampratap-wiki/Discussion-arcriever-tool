#!/usr/bin/env bash
# ==============================================================================
# हिन्दी विकिपीडिया चर्चा समापन एवं पुरालेखण टूल - GitHub पुश सहायक स्क्रिप्ट
# लेख: सदस्य:विक्रम प्रताप
# ==============================================================================

set -e

# रंग कोड
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}==============================================================================${NC}"
echo -e "${GREEN}  हिन्दी विकिपीडिया चर्चा समापन एवं पुरालेखण टूल - GitHub Export Helper${NC}"
echo -e "${BLUE}==============================================================================${NC}"
echo ""

# सुनिश्चित करें कि हम उसी डायरेक्टरी में हैं
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 1. गिट की उपस्थिति जाँचें
if ! command -v git &> /dev/null; then
    echo -e "${RED}त्रुटि: आपके सिस्टम पर 'git' संस्थापित नहीं है। कृपया पहले git संस्थापित करें।${NC}"
    exit 1
fi

# 2. गिट इनिशियलाइज़
if [ ! -d ".git" ]; then
    echo -e "${YELLOW}>> Git रिपॉजिटरी इनिशियलाइज़ की जा रही है...${NC}"
    git init
    git branch -M main
else
    echo -e "${GREEN}✓ Git रिपॉजिटरी पहले से इनिशियलाइज़्ड है।${NC}"
fi

# 3. फ़ाइलें स्टेज करें
echo -e "${YELLOW}>> फ़ाइलों को स्टेज किया जा रहा है (git add .)...${NC}"
git add .

# 4. कमिट बनाएँ
echo -e "${YELLOW}>> कमिट बनाया जा रहा है...${NC}"
if git diff-index --quiet HEAD -- 2>/dev/null; then
    echo -e "${GREEN}✓ कोई नया परिवर्तन कमिट करने के लिए नहीं है।${NC}"
else
    git commit -m "feat: Initial release of Hindi Wikipedia Discussion Archiver Web Tool"
    echo -e "${GREEN}✓ कमिट संपन्न!${NC}"
fi

echo ""
echo -e "${BLUE}------------------------------------------------------------------------------${NC}"
echo -e "${GREEN}अब इस कोड को GitHub पर भेजने के 2 आसान विकल्प हैं:${NC}"
echo -e "${BLUE}------------------------------------------------------------------------------${NC}"

# विकल्प 1: यदि GitHub CLI मौजूद है
if command -v gh &> /dev/null; then
    echo -e "${GREEN}✓ GitHub CLI (gh) उपलब्ध है!${NC}"
    read -p "क्या आप GitHub CLI द्वारा स्वचालित रूप से नया रिपॉजिटरी बनाकर पुश करना चाहते हैं? (y/n): " use_gh
    if [[ "$use_gh" =~ ^[Yy]$ ]]; then
        read -p "रिपॉजिटरी का नाम दर्ज करें [डिफ़ॉल्ट: hindi-wiki-discussion-archiver]: " repo_name
        repo_name=${repo_name:-hindi-wiki-discussion-archiver}
        echo -e "${YELLOW}>> GitHub पर रिपॉजिटरी बनाई जा रही है और कोड पुश हो रहा है...${NC}"
        gh repo create "$repo_name" --public --source=. --remote=origin --push
        echo ""
        echo -e "${GREEN}🎉 बधाई! आपका कोड सफलतापूर्वक GitHub पर प्रकाशित हो गया!${NC}"
        exit 0
    fi
fi

# विकल्प 2: मैन्युअल रिमोट यूआरएल
echo ""
echo -e "${YELLOW}कृपया अपने GitHub रिपॉजिटरी का URL प्रदान करें।${NC}"
echo -e "उदाहरण: ${BLUE}https://github.com/<आपका-यूज़रनेम>/hindi-wiki-discussion-archiver.git${NC}"
echo ""
read -p "GitHub Repository URL (खाली छोड़ने पर बाहर निकल जाएगा): " remote_url

if [ -n "$remote_url" ]; then
    # मौजूदा रिमोट हटाकर नया जोड़ें
    git remote remove origin 2>/dev/null || true
    git remote add origin "$remote_url"
    
    echo -e "${YELLOW}>> कोड GitHub पर पुश किया जा रहा है (git push -u origin main)...${NC}"
    git push -u origin main

    echo ""
    echo -e "${GREEN}==============================================================================${NC}"
    echo -e "${GREEN}🎉 बधाई! आपकी वेबसाइट GitHub पर सफलतापूर्वक एक्सपोर्ट हो गई है!${NC}"
    echo -e "${GREEN}==============================================================================${NC}"
    echo ""
    echo -e "${BLUE}🌐 GitHub Pages को 1 मिनट में चालू करने के चरण:${NC}"
    echo -e "  1. GitHub पर अपने रिपॉजिटरी के ${YELLOW}Settings${NC} टैब पर जाएँ।"
    echo -e "  2. बाएँ मेनू से ${YELLOW}Pages${NC} चुनें।"
    echo -e "  3. 'Build and deployment' के तहत ${YELLOW}Deploy from a branch${NC} चुनें।"
    echo -e "  4. Branch में ${GREEN}main${NC} और फोल्डर में ${GREEN}/ (root)${NC} चुनकर ${YELLOW}Save${NC} करें।"
    echo -e "  5. कुछ ही सेकंडों में आपको अपनी लाइव टूल वेबसाइट का लिंक मिल जाएगा!"
    echo ""
else
    echo -e "${YELLOW}कोई URL नहीं दिया गया। आप बाद में निम्नलिखित कमांड चलाकर कभी भी पुश कर सकते हैं:${NC}"
    echo -e "  ${BLUE}git remote add origin <आपका-रिपॉजिटरी-URL>${NC}"
    echo -e "  ${BLUE}git push -u origin main${NC}"
fi
