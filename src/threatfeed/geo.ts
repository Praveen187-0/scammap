// Approximate country positions for the global threat layer. Points are rough country centres (good enough to draw a
// ring of markers per country), not where any server really is. ISO 3166-1 alpha-2 code, name, latitude, longitude.
const RAW =
  "AD,Andorra,42.5,1.5|AE,United Arab Emirates,24,54|AF,Afghanistan,33.9,67.7|AG,Antigua and Barbuda,17.1,-61.8|AL,Albania,41.2,20.2|" +
  "AM,Armenia,40.1,45|AO,Angola,-11.2,17.9|AR,Argentina,-38.4,-63.6|AT,Austria,47.5,14.6|AU,Australia,-25.3,133.8|AW,Aruba,12.5,-70|" +
  "AZ,Azerbaijan,40.1,47.6|BA,Bosnia and Herzegovina,43.9,17.7|BB,Barbados,13.2,-59.5|BD,Bangladesh,23.7,90.4|BE,Belgium,50.5,4.5|" +
  "BF,Burkina Faso,12.2,-1.6|BG,Bulgaria,42.7,25.5|BH,Bahrain,26,50.6|BI,Burundi,-3.4,29.9|BJ,Benin,9.3,2.3|BM,Bermuda,32.3,-64.8|" +
  "BN,Brunei,4.5,114.7|BO,Bolivia,-16.3,-63.6|BR,Brazil,-14.2,-51.9|BS,Bahamas,25,-77.4|BT,Bhutan,27.5,90.4|BW,Botswana,-22.3,24.7|" +
  "BY,Belarus,53.7,28|BZ,Belize,17.2,-88.5|CA,Canada,56.1,-106.3|CD,DR Congo,-4,21.8|CF,Central African Republic,6.6,20.9|" +
  "CG,Congo,-0.2,15.8|CH,Switzerland,46.8,8.2|CI,Côte d'Ivoire,7.5,-5.5|CL,Chile,-35.7,-71.5|CM,Cameroon,7.4,12.4|CN,China,35.9,104.2|" +
  "CO,Colombia,4.6,-74.3|CR,Costa Rica,9.7,-83.8|CU,Cuba,21.5,-77.8|CV,Cape Verde,16,-24|CW,Curaçao,12.2,-69|CY,Cyprus,35.1,33.4|" +
  "CZ,Czechia,49.8,15.5|DE,Germany,51.2,10.5|DJ,Djibouti,11.8,42.6|DK,Denmark,56.3,9.5|DM,Dominica,15.4,-61.4|" +
  "DO,Dominican Republic,18.7,-70.2|DZ,Algeria,28,1.7|EC,Ecuador,-1.8,-78.2|EE,Estonia,58.6,25|EG,Egypt,26.8,30.8|ER,Eritrea,15.2,39.8|" +
  "ES,Spain,40.5,-3.7|ET,Ethiopia,9.1,40.5|EU,Europe (EU),50.5,9|FI,Finland,61.9,25.7|FJ,Fiji,-17.7,178.1|FR,France,46.2,2.2|" +
  "GA,Gabon,-0.8,11.6|GB,United Kingdom,54,-2.5|GE,Georgia,42.3,43.4|GF,French Guiana,3.9,-53.1|GH,Ghana,7.9,-1|GI,Gibraltar,36.1,-5.35|" +
  "GM,Gambia,13.4,-15.3|GN,Guinea,9.9,-9.7|GP,Guadeloupe,16.3,-61.6|GQ,Equatorial Guinea,1.7,10.3|GR,Greece,39.1,21.8|" +
  "GT,Guatemala,15.8,-90.2|GY,Guyana,4.9,-58.9|HK,Hong Kong,22.3,114.2|HN,Honduras,15.2,-86.2|HR,Croatia,45.1,15.2|HT,Haiti,19,-72.3|" +
  "HU,Hungary,47.2,19.5|ID,Indonesia,-0.8,113.9|IE,Ireland,53.4,-8.2|IL,Israel,31,34.9|IN,India,20.6,79|IQ,Iraq,33.2,43.7|IR,Iran,32.4,53.7|" +
  "IS,Iceland,65,-19|IT,Italy,41.9,12.6|JM,Jamaica,18.1,-77.3|JO,Jordan,30.6,36.2|JP,Japan,36.2,138.3|KE,Kenya,0,37.9|" +
  "KG,Kyrgyzstan,41.2,74.8|KH,Cambodia,12.6,105|KP,North Korea,40.3,127.5|KR,South Korea,35.9,127.8|KW,Kuwait,29.3,47.5|" +
  "KY,Cayman Islands,19.3,-81.3|KZ,Kazakhstan,48,66.9|LA,Laos,19.9,102.5|LB,Lebanon,33.9,35.9|LI,Liechtenstein,47.2,9.6|" +
  "LK,Sri Lanka,7.9,80.8|LR,Liberia,6.4,-9.4|LS,Lesotho,-29.6,28.2|LT,Lithuania,55.2,23.9|LU,Luxembourg,49.8,6.1|LV,Latvia,56.9,24.6|" +
  "LY,Libya,26.3,17.2|MA,Morocco,31.8,-7.1|MC,Monaco,43.7,7.4|MD,Moldova,47.4,28.4|ME,Montenegro,42.7,19.4|MG,Madagascar,-18.8,46.9|" +
  "MK,North Macedonia,41.6,21.7|ML,Mali,17.6,-4|MM,Myanmar,21.9,96|MN,Mongolia,46.9,103.8|MO,Macao,22.2,113.5|MQ,Martinique,14.6,-61|" +
  "MR,Mauritania,21,-10.9|MT,Malta,35.9,14.4|MU,Mauritius,-20.3,57.6|MV,Maldives,3.2,73.2|MW,Malawi,-13.3,34.3|MX,Mexico,23.6,-102.6|" +
  "MY,Malaysia,4.2,102|MZ,Mozambique,-18.7,35.5|NA,Namibia,-23,18.5|NC,New Caledonia,-20.9,165.6|NE,Niger,17.6,8.1|NG,Nigeria,9.1,8.7|" +
  "NI,Nicaragua,12.9,-85.2|NL,Netherlands,52.1,5.3|NO,Norway,60.5,8.5|NP,Nepal,28.4,84.1|NZ,New Zealand,-40.9,174.9|OM,Oman,21.5,55.9|" +
  "PA,Panama,8.5,-80.8|PE,Peru,-9.2,-75|PF,French Polynesia,-17.7,-149.4|PG,Papua New Guinea,-6.3,144|PH,Philippines,12.9,121.8|" +
  "PK,Pakistan,30.4,69.3|PL,Poland,51.9,19.1|PR,Puerto Rico,18.2,-66.6|PS,Palestine,31.95,35.2|PT,Portugal,39.4,-8.2|PY,Paraguay,-23.4,-58.4|" +
  "QA,Qatar,25.4,51.2|RE,Réunion,-21.1,55.5|RO,Romania,45.9,25|RS,Serbia,44,21|RU,Russia,61.5,105.3|RW,Rwanda,-1.9,29.9|" +
  "SA,Saudi Arabia,23.9,45.1|SB,Solomon Islands,-9.6,160.2|SC,Seychelles,-4.7,55.5|SD,Sudan,12.9,30.2|SE,Sweden,60.1,18.6|" +
  "SG,Singapore,1.35,103.8|SI,Slovenia,46.2,15|SK,Slovakia,48.7,19.7|SL,Sierra Leone,8.5,-11.8|SM,San Marino,43.9,12.5|SN,Senegal,14.5,-14.5|" +
  "SO,Somalia,5.2,46.2|SR,Suriname,3.9,-56|SV,El Salvador,13.8,-88.9|SY,Syria,34.8,39|SZ,Eswatini,-26.5,31.5|TD,Chad,15.5,18.7|" +
  "TG,Togo,8.6,0.8|TH,Thailand,15.9,101|TJ,Tajikistan,38.9,71.3|TL,Timor-Leste,-8.9,125.7|TM,Turkmenistan,39,59.6|TN,Tunisia,33.9,9.5|" +
  "TR,Türkiye,39,35.2|TT,Trinidad and Tobago,10.7,-61.2|TW,Taiwan,23.7,121|TZ,Tanzania,-6.4,34.9|UA,Ukraine,48.4,31.2|UG,Uganda,1.4,32.3|" +
  "US,United States,37.1,-95.7|UY,Uruguay,-32.5,-55.8|UZ,Uzbekistan,41.4,64.6|VE,Venezuela,6.4,-66.6|VG,British Virgin Islands,18.4,-64.6|" +
  "VN,Vietnam,14.1,108.3|VU,Vanuatu,-15.4,167|WS,Samoa,-13.8,-172.1|XK,Kosovo,42.6,20.9|YE,Yemen,15.6,48.5|ZA,South Africa,-30.6,22.9|" +
  "ZM,Zambia,-13.1,27.8|ZW,Zimbabwe,-19,29.2";

export interface Country {
  code: string;
  name: string;
  lat: number;
  lng: number;
}
export const COUNTRIES: ReadonlyMap<string, Country> = new Map(
  RAW.split("|").map((row) => {
    const [code, name, lat, lng] = row.split(",");
    return [code!, { code: code!, name: name!, lat: Number(lat), lng: Number(lng) }];
  }),
);

// Country-code endings that are mostly sold worldwide as generic names (.io, .co, .me, .tk…): they say nothing about
// where a site is, so those hosts are placed by their IP address instead.
const VANITY = new Set("io co me tv cc ws to ly ai gg sh fm am la nu tk ml ga cf gq pw vc so st gl cx ac im ms bz".split(" "));
const SPECIAL: Record<string, string> = { uk: "GB", eu: "EU", su: "RU" };

/** Country from a domain's ending (.ru -> RU, .co.uk -> GB), or null for generic and vanity endings. */
export function countryFromTld(host: string): string | null {
  const tld = host.toLowerCase().replace(/\.$/, "").split(".").pop() ?? "";
  if (!/^[a-z]{2}$/.test(tld) || VANITY.has(tld)) return null;
  const code = SPECIAL[tld] ?? tld.toUpperCase();
  return COUNTRIES.has(code) ? code : null;
}

const BIG = new Set(["RU", "US", "CN", "CA", "BR", "AU", "IN", "KZ", "AR", "DZ", "SA", "MX", "ID"]);

/** A stable spot on a ring around the country's centre, so many markers in one country don't sit on top of each other. */
export function ringPosition(id: string, code: string): [number, number] | null {
  const c = COUNTRIES.get(code);
  if (!c) return null;
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  const u = (h >>> 0) / 4294967296;
  const v = ((Math.imul(h, 2654435761) >>> 0) % 1000) / 1000;
  const angle = u * Math.PI * 2;
  const radius = (BIG.has(code) ? 3 : 0.8) + v * (BIG.has(code) ? 6 : 1.8);
  const lat = Math.max(-75, Math.min(78, c.lat + Math.sin(angle) * radius * 0.7));
  return [Math.round(lat * 1000) / 1000, Math.round((c.lng + Math.cos(angle) * radius) * 1000) / 1000];
}
