// The "kill chain" of a scam: the five steps every campaign goes through, with what each step looks like for each
// scam type. Used to turn a campaign's reports into a readable attack story (English and Hindi).
export type StageKey = "contact" | "hook" | "pressure" | "payment" | "cashout";

export const STAGES: ReadonlyArray<{ key: StageKey; en: string; hi: string }> = [
  { key: "contact", en: "First contact", hi: "पहला संपर्क" },
  { key: "hook", en: "Hook", hi: "जाल" },
  { key: "pressure", en: "Pressure", hi: "दबाव" },
  { key: "payment", en: "Payment", hi: "भुगतान" },
  { key: "cashout", en: "Cash-out", hi: "पैसा निकालना" },
];

type Story = Record<Exclude<StageKey, "contact" | "cashout">, [string, string]>;
const S = (hook: [string, string], pressure: [string, string], payment: [string, string]): Story => ({ hook, pressure, payment });

export const PLAYBOOK: Readonly<Record<string, Story>> = {
  "digital-arrest": S(["Claims a parcel or SIM in your name is linked to a crime", "दावा कि आपके नाम का पार्सल या SIM अपराध से जुड़ा है"], ["Keeps you on a video call under 'digital arrest', tells you to tell no one", "वीडियो कॉल पर 'डिजिटल अरेस्ट', किसी को न बताने को कहता है"], ["Asks for a 'verification deposit' to clear your name", "नाम साफ़ करने के लिए 'जाँच जमा' माँगता है"]),
  "fake-kyc-link": S(["SMS link to 'update KYC' on a look-alike bank page", "नकली बैंक पेज पर 'KYC अपडेट' का SMS लिंक"], ["Says the account or card will be blocked today", "कहता है खाता या कार्ड आज ब्लॉक होगा"], ["Captures login, OTP or card details and drains the account", "लॉगिन, OTP या कार्ड की जानकारी लेकर खाता खाली करता है"]),
  "upi-refund-qr": S(["Poses as a buyer or offers a refund", "खरीदार बनकर या रिफ़ंड का ऑफ़र"], ["Hurries you to scan a QR code 'to receive'", "'पैसे पाने के लिए' QR स्कैन करने की जल्दी"], ["The QR is a collect request: scanning and entering the PIN pays them", "QR असल में भुगतान अनुरोध है: स्कैन और PIN से पैसे उनके पास"]),
  "investment-group": S(["Adds you to a WhatsApp or Telegram 'stock tips' group", "WhatsApp/Telegram 'स्टॉक टिप्स' ग्रुप में जोड़ता है"], ["Shows fake profits and 'limited seats'", "नकली मुनाफ़ा और 'सीमित सीटें' दिखाता है"], ["Deposits go to a fake app that never lets you withdraw", "पैसा नकली ऐप में, निकाल नहीं सकते"]),
  "courier-customs": S(["Says your courier is held at customs", "कहता है आपका कूरियर कस्टम में रुका है"], ["Threatens a police case over 'illegal items'", "'ग़ैरक़ानूनी सामान' पर पुलिस केस की धमकी"], ["Asks for a fee or fine to release it", "छुड़ाने के लिए फ़ीस या जुर्माना माँगता है"]),
  "job-offer": S(["Offers easy money for liking videos or reviews", "वीडियो लाइक या रिव्यू पर आसान कमाई का ऑफ़र"], ["Pays small amounts first, then 'unlocks' bigger tasks", "पहले थोड़ा पैसा, फिर बड़े 'टास्क'"], ["Asks for deposits to withdraw your earnings", "कमाई निकालने के लिए जमा राशि माँगता है"]),
  "lottery-prize": S(["Says you won a prize or lucky draw", "कहता है आपने इनाम या लकी ड्रॉ जीता"], ["Prize expires today unless you act", "आज ही करें वरना इनाम ख़त्म"], ["Asks for a 'processing fee' or tax first", "पहले 'प्रोसेसिंग फ़ीस' या टैक्स माँगता है"]),
  "loan-app-harassment": S(["Instant loan app with no checks", "बिना जाँच का तुरंत लोन ऐप"], ["Threatens to message your contacts or morph photos", "कॉन्टैक्ट्स को मैसेज या फ़ोटो से छेड़छाड़ की धमकी"], ["Demands repeated payments far above the loan", "लोन से कहीं ज़्यादा बार-बार पैसे माँगता है"]),
  "electricity-disconnection": S(["SMS: power will be cut tonight", "SMS: आज रात बिजली कटेगी"], ["Tells you to call an 'officer' at once", "तुरंत 'अधिकारी' को कॉल करने को कहता है"], ["Gets you to install an app or pay a small bill, then empties the account", "ऐप इंस्टॉल या छोटा बिल भुगतान करवाकर खाता खाली"]),
  "fake-customer-care": S(["Fake helpline number found online", "ऑनलाइन मिला नकली हेल्पलाइन नंबर"], ["Says your refund needs 'verification'", "कहता है रिफ़ंड के लिए 'वेरिफ़िकेशन' चाहिए"], ["Asks you to install a screen-sharing app and enter your PIN", "स्क्रीन-शेयर ऐप इंस्टॉल कर PIN डलवाता है"]),
  "otp-call": S(["Caller poses as the bank or card team", "कॉलर बैंक या कार्ड टीम बनकर"], ["'Suspicious transaction, act now'", "'संदिग्ध लेन-देन, तुरंत करें'"], ["Asks for the OTP and uses it to pay", "OTP माँगकर उससे भुगतान करता है"]),
  sextortion: S(["A video call from a stranger", "अजनबी की वीडियो कॉल"], ["Threatens to share a morphed recording", "छेड़छाड़ की रिकॉर्डिंग फैलाने की धमकी"], ["Demands money to 'delete' it", "'डिलीट' करने के लिए पैसे माँगता है"]),
  other: S(["An unexpected message or call", "अचानक मैसेज या कॉल"], ["Urgency or fear", "जल्दबाज़ी या डर"], ["A request for money or a code", "पैसे या कोड की माँग"]),
};

export const CASHOUT: [string, string] = ["Money moves at once through other accounts (mule accounts)", "पैसा तुरंत दूसरे खातों (म्यूल खातों) से आगे भेजा जाता है"];
