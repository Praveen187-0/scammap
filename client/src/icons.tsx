// One consistent icon set (lucide) for scam types, channels and identifier types.
import {
  BriefcaseBusiness, CircleHelp, Ellipsis, Gift, Globe, HandCoins, Headset, IndianRupee, KeyRound, Link2,
  Mail, MessageSquareText, Package, Phone, QrCode, Siren, TrendingUp, Webcam, Zap, type LucideIcon,
} from "lucide-react";

export const SCAM_ICON: Record<string, LucideIcon> = {
  "digital-arrest": Siren,
  "fake-kyc-link": Link2,
  "upi-refund-qr": QrCode,
  "investment-group": TrendingUp,
  "courier-customs": Package,
  "job-offer": BriefcaseBusiness,
  "lottery-prize": Gift,
  "loan-app-harassment": HandCoins,
  "electricity-disconnection": Zap,
  "fake-customer-care": Headset,
  "otp-call": KeyRound,
  sextortion: Webcam,
  other: CircleHelp,
};

export const CHANNEL_ICON: Record<string, LucideIcon> = {
  "Phone call": Phone,
  "SMS or WhatsApp": MessageSquareText,
  "QR code": QrCode,
  "Fake website": Globe,
  "UPI request": IndianRupee,
  "Something else": Ellipsis,
};

export const TYPE_ICON: Record<string, LucideIcon> = {
  phone: Phone,
  upi: IndianRupee,
  url: Link2,
  sender_id: MessageSquareText,
  email: Mail,
};

export function ScamIcon({ type, size = 18 }: { type: string | null | undefined; size?: number }) {
  const I = SCAM_ICON[type ?? "other"] ?? CircleHelp;
  return <I size={size} aria-hidden="true" />;
}
