"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { navItems } from "../lib/longgrind";
import {
  defaultStatsView,
  statsViewStorageKey,
} from "../stats/preferences";

function resetStatsNavigationPreference() {
  try {
    window.localStorage.setItem(statsViewStorageKey, defaultStatsView);
  } catch {
    // The cookie is enough for the next server-rendered stats entry.
  }

  document.cookie = `${statsViewStorageKey}=${encodeURIComponent(defaultStatsView)}; Max-Age=31536000; Path=/; SameSite=Lax`;
  window.dispatchEvent(new Event(statsViewStorageKey));
}

export default function SiteFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="site-shell">
      <header className="site-header">
        <Link className="brand-lockup" href="/records" aria-label="LongGrind 牌局">
          <Image src="/assets/avatar.png" alt="" width={42} height={42} priority unoptimized />
          <span>
            <strong className="brand-aurora-text">LONGGRIND</strong>
            <small>把波动写成路径</small>
          </span>
        </Link>

        <nav className="site-nav" aria-label="主要页面">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                className={isActive ? "active" : ""}
                href={item.href}
                onClick={item.href === "/stats" ? resetStatsNavigationPreference : undefined}
                prefetch={item.href === "/stats" ? false : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      {children}
    </div>
  );
}
