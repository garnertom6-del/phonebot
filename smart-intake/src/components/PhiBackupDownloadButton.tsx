"use client";

import type { ReactNode } from "react";
import { PHI_BACKUP_CONFIRM_MESSAGE, PHI_BACKUP_PATH, phiBackupDownloadUrl } from "@/lib/phiBackupDownload";

/**
 * PHI dump starts as a link with no confirmPhi param. The confirm query is
 * attached only after the staff dialog — never pre-baked in the href.
 */
export default function PhiBackupDownloadButton({ className, children = "Download backup" }: {
  className?: string;
  children?: ReactNode;
}) {
  return (
    <a
      href={PHI_BACKUP_PATH}
      className={className}
      onClick={(event) => {
        event.preventDefault();
        if (window.confirm(PHI_BACKUP_CONFIRM_MESSAGE)) {
          window.location.assign(phiBackupDownloadUrl(true));
        }
      }}
    >
      {children}
    </a>
  );
}
