import { openExternalLink } from "../runtime/desktop";

export const ExcalidrawPlusPromoBanner = ({
  isSignedIn,
}: {
  isSignedIn: boolean;
}) => {
  const href = isSignedIn
    ? import.meta.env.VITE_APP_PLUS_APP
    : `${
        import.meta.env.VITE_APP_PLUS_LP
      }/plus?utm_source=excalidraw&utm_medium=app&utm_content=guestBanner#excalidraw-redirect`;

  return (
    <button
      type="button"
      className="plus-banner"
      onClick={() => void openExternalLink(href)}
    >
      Excalidraw+
    </button>
  );
};
