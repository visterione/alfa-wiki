import React from 'react';
import {
  Activity, Baby, BadgeCheck, Beaker, Bone, BookOpen, Bot, Brain, Briefcase,
  Building2, Calculator, CalendarDays, Camera, ClipboardList, Cpu, CreditCard,
  Cross, Crown, Database, Dna, Droplet, Ear, Eye, Flame, FlaskConical, Gavel,
  Gem, Globe, GraduationCap, Hammer, Headphones, Heart, HeartPulse, Key,
  Landmark, Laptop, Leaf, LifeBuoy, Lightbulb, Megaphone, Microscope, Monitor,
  Palette, PenTool, Percent, Phone, PhoneCall, Pill, Printer, Rocket, Scale,
  ScanLine, Scissors, Send, Settings, Shield, ShieldCheck, ShoppingCart, Siren,
  Smile, Sparkles, Speech, Star, Stethoscope, Syringe, Target, Thermometer,
  Trophy, Truck, UserCog, Users, Wallet, Wrench, Zap,
} from 'lucide-react-native';

// Зеркало frontend/src/components/chat/badgeIcons.js. Метку считает бэкенд
// (иконка от роли, цвет от клиники), сюда приходит готовый объект.
const ICONS = {
  Activity, Baby, BadgeCheck, Beaker, Bone, BookOpen, Bot, Brain, Briefcase,
  Building2, Calculator, CalendarDays, Camera, ClipboardList, Cpu, CreditCard,
  Cross, Crown, Database, Dna, Droplet, Ear, Eye, Flame, FlaskConical, Gavel,
  Gem, Globe, GraduationCap, Hammer, Headphones, Heart, HeartPulse, Key,
  Landmark, Laptop, Leaf, LifeBuoy, Lightbulb, Megaphone, Microscope, Monitor,
  Palette, PenTool, Percent, Phone, PhoneCall, Pill, Printer, Rocket, Scale,
  ScanLine, Scissors, Send, Settings, Shield, ShieldCheck, ShoppingCart, Siren,
  Smile, Sparkles, Speech, Star, Stethoscope, Syringe, Target, Thermometer,
  Trophy, Truck, UserCog, Users, Wallet, Wrench, Zap,
};

export default function UserBadge({badge, size = 16}) {
  if (!badge?.value) return null;
  const Icon = ICONS[badge.value] || BadgeCheck;
  return <Icon size={size} color={badge.color || '#94a3b8'} accessibilityLabel={badge.label} />;
}
