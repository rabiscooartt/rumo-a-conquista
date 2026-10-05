"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type {
  SiteBannerKey,
  SiteBannerSetting,
} from "@/lib/banner-types";

type BannerSettingsMap = Record<SiteBannerKey, SiteBannerSetting>;

type ContextValue = {
  settings: BannerSettingsMap;
  update: (key: SiteBannerKey, setting: SiteBannerSetting) => void;
};

const BannerSettingsContext = createContext<ContextValue | null>(null);

export default function BannerSettingsProvider({
  initialSettings,
  children,
}: {
  initialSettings: BannerSettingsMap;
  children: ReactNode;
}) {
  const [settings, setSettings] = useState<BannerSettingsMap>(initialSettings);

  const update = useCallback(
    (key: SiteBannerKey, setting: SiteBannerSetting) => {
      setSettings((current) => ({
        ...current,
        [key]: setting,
      }));
    },
    []
  );

  const value = useMemo(() => ({ settings, update }), [settings, update]);

  return (
    <BannerSettingsContext.Provider value={value}>
      {children}
    </BannerSettingsContext.Provider>
  );
}

export function useBannerSettings(key: SiteBannerKey) {
  const context = useContext(BannerSettingsContext);

  if (!context) {
    throw new Error(
      "useBannerSettings deve ser usado dentro de BannerSettingsProvider."
    );
  }

  return {
    setting: context.settings[key],
    update: (setting: SiteBannerSetting) => context.update(key, setting),
  };
}
