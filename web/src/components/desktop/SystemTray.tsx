import { useState, useEffect } from 'react';
import { Wifi, Volume2, BatteryFull } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

export default function SystemTray() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = time.toLocaleDateString([], { month: 'short', day: 'numeric' });
  const isMobile = useIsMobile();
 
  return (
    <div className={`flex items-center text-gray-300 ml-1 rounded-xl bg-white/5 border border-white/5
      ${isMobile ? 'gap-2 px-2 py-1' : 'gap-4 px-3 py-1.5'}
    `}>
      {/* System indicators */}
      <div className={`flex items-center text-gray-400 ${isMobile ? 'gap-1.5' : 'gap-2.5'}`}>
        <Wifi className={`${isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'} hover:text-emerald-400 transition-colors cursor-pointer`} />
        {!isMobile && <Volume2 className="w-4 h-4 hover:text-emerald-400 transition-colors cursor-pointer" />}
        <BatteryFull className={`${isMobile ? 'w-3.5 h-3.5' : 'w-4 h-4'} hover:text-emerald-400 transition-colors cursor-pointer`} />
      </div>
 
      {/* Separator */}
      <div className="w-px h-6 bg-white/10" />
 
      {/* Clock */}
      <div className="flex flex-col items-center leading-tight cursor-default">
        <span className={`${isMobile ? 'text-[10px]' : 'text-[11px]'} font-semibold text-gray-200`}>{timeStr}</span>
        {!isMobile && <span className="text-[9px] text-gray-300 font-medium uppercase tracking-tighter">{dateStr}</span>}
      </div>
    </div>
  );
}
