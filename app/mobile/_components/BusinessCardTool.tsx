import { ArrowUpRight, ContactRound } from 'lucide-react';

export default function BusinessCardTool() {
  return <a className="rm-menu-row rm-business-card-tool" href="https://happy-solar-bloom-portal.vercel.app/business-card" target="_blank" rel="noopener noreferrer">
    <span className="rm-metric-icon sage"><ContactRound size={21} /></span>
    <span><strong>Business card creator</strong><small>Create your Happy Solar business card · opens in your browser</small></span>
    <ArrowUpRight size={19} aria-hidden="true" />
  </a>;
}
