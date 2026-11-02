"use client";

import { Modal } from "./Modal";
import { SidebarContent } from "./Sidebar";
import { ViewSwitcher } from "./ViewSwitcher";
import { SearchBox } from "./SearchBox";
import { t } from "@/lib/i18n";
import { XIcon } from "./icons";

/** The sidebar as a drawer on narrow screens, with the view switcher and search
 *  that the cramped top bar leaves out. */
export function MobileNav({ onClose }: { onClose: () => void }) {
  return (
    <Modal label={t("nav.drawer")} onClose={onClose} className="m-0! mr-auto! h-full max-h-full w-[min(88vw,320px)] rounded-none rounded-r-[8px]">
      <div className="flex h-full flex-col" data-testid="mobile-nav">
        <div className="flex items-center justify-between px-3 pt-3">
          <ViewSwitcher />
          <button type="button" aria-label={t("nav.closeMenu")} onClick={onClose} className="grid size-control-sm place-items-center rounded-ui text-muted hover:bg-bg/50 hover:text-text">
            <XIcon />
          </button>
        </div>
        <div className="px-3 pt-3">
          <SearchBox always />
        </div>
        <div className="min-h-0 flex-1">
          <SidebarContent />
        </div>
      </div>
    </Modal>
  );
}
