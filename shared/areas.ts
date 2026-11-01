// The 25 areas from Appendix B. The map always uses these points, never a reporter's location.
// Add more areas here; nothing else needs to change.
export interface Area {
  pincode: string;
  locality: string;
  localityHi: string;
  city: string;
  lat: number;
  lng: number;
}

export const AREAS: readonly Area[] = [
  { pincode: "560102", locality: "HSR Layout", localityHi: "एचएसआर लेआउट", city: "Bengaluru", lat: 12.9116, lng: 77.6473 },
  { pincode: "560038", locality: "Indiranagar", localityHi: "इंदिरानगर", city: "Bengaluru", lat: 12.9784, lng: 77.6408 },
  { pincode: "560034", locality: "Koramangala", localityHi: "कोरमंगला", city: "Bengaluru", lat: 12.9352, lng: 77.6245 },
  { pincode: "560066", locality: "Whitefield", localityHi: "व्हाइटफ़ील्ड", city: "Bengaluru", lat: 12.9698, lng: 77.75 },
  { pincode: "560076", locality: "BTM Layout", localityHi: "बीटीएम लेआउट", city: "Bengaluru", lat: 12.9166, lng: 77.6101 },
  { pincode: "560011", locality: "Jayanagar", localityHi: "जयनगर", city: "Bengaluru", lat: 12.9299, lng: 77.5826 },
  { pincode: "560037", locality: "Marathahalli", localityHi: "मराठाहल्ली", city: "Bengaluru", lat: 12.9591, lng: 77.6974 },
  { pincode: "560103", locality: "Bellandur", localityHi: "बेलंदूर", city: "Bengaluru", lat: 12.926, lng: 77.6762 },
  { pincode: "560100", locality: "Electronic City", localityHi: "इलेक्ट्रॉनिक सिटी", city: "Bengaluru", lat: 12.8452, lng: 77.6602 },
  { pincode: "560078", locality: "JP Nagar", localityHi: "जेपी नगर", city: "Bengaluru", lat: 12.9077, lng: 77.5851 },
  { pincode: "560003", locality: "Malleshwaram", localityHi: "मल्लेश्वरम", city: "Bengaluru", lat: 13.0035, lng: 77.5709 },
  { pincode: "560010", locality: "Rajajinagar", localityHi: "राजाजीनगर", city: "Bengaluru", lat: 12.9915, lng: 77.552 },
  { pincode: "560024", locality: "Hebbal", localityHi: "हेब्बाल", city: "Bengaluru", lat: 13.0358, lng: 77.597 },
  { pincode: "560064", locality: "Yelahanka", localityHi: "येलहंका", city: "Bengaluru", lat: 13.1007, lng: 77.5963 },
  { pincode: "560070", locality: "Banashankari", localityHi: "बनशंकरी", city: "Bengaluru", lat: 12.925, lng: 77.5468 },
  { pincode: "400050", locality: "Bandra West", localityHi: "बांद्रा पश्चिम", city: "Mumbai", lat: 19.0596, lng: 72.8295 },
  { pincode: "110016", locality: "Hauz Khas", localityHi: "हौज़ ख़ास", city: "Delhi", lat: 28.5494, lng: 77.2001 },
  { pincode: "500081", locality: "Madhapur", localityHi: "माधापुर", city: "Hyderabad", lat: 17.4486, lng: 78.3908 },
  { pincode: "600020", locality: "Adyar", localityHi: "अड्यार", city: "Chennai", lat: 13.0012, lng: 80.2565 },
  { pincode: "411014", locality: "Viman Nagar", localityHi: "विमान नगर", city: "Pune", lat: 18.5679, lng: 73.9143 },
  { pincode: "700091", locality: "Salt Lake Sector V", localityHi: "सॉल्ट लेक सेक्टर V", city: "Kolkata", lat: 22.579, lng: 88.429 },
  { pincode: "380015", locality: "Satellite", localityHi: "सैटेलाइट", city: "Ahmedabad", lat: 23.026, lng: 72.5085 },
  { pincode: "302017", locality: "Malviya Nagar", localityHi: "मालवीय नगर", city: "Jaipur", lat: 26.857, lng: 75.808 },
  { pincode: "226010", locality: "Gomti Nagar", localityHi: "गोमती नगर", city: "Lucknow", lat: 26.854, lng: 80.999 },
  { pincode: "682030", locality: "Kakkanad", localityHi: "काक्कनाड", city: "Kochi", lat: 10.0159, lng: 76.3419 },
];

export const AREA_BY_PIN: ReadonlyMap<string, Area> = new Map(AREAS.map((a) => [a.pincode, a]));

export function findArea(pincode: string | null | undefined): Area | undefined {
  if (!pincode) return undefined;
  return AREA_BY_PIN.get(String(pincode).trim());
}

/** Great-circle distance in km between two points. */
export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371;
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function areasWithin(center: Area, radiusKm: number): Area[] {
  return AREAS.filter((a) => haversineKm(center.lat, center.lng, a.lat, a.lng) <= radiusKm + 1e-9);
}
