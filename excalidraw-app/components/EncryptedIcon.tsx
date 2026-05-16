import { Tooltip } from "@excalidraw/excalidraw/components/Tooltip";
import { shield } from "@excalidraw/excalidraw/components/icons";
import { useI18n } from "@excalidraw/excalidraw/i18n";

import { openExternalLink } from "../runtime/desktop";

export const EncryptedIcon = () => {
  const { t } = useI18n();

  return (
    <button
      type="button"
      className="encrypted-icon tooltip"
      aria-label={t("encrypted.link")}
      onClick={() =>
        void openExternalLink(
          "https://plus.excalidraw.com/blog/end-to-end-encryption",
        )
      }
    >
      <Tooltip label={t("encrypted.tooltip")} long={true}>
        {shield}
      </Tooltip>
    </button>
  );
};
