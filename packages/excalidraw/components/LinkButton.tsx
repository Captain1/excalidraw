import { FilledButton } from "./FilledButton";

export const LinkButton = ({
  children,
  href,
  onClick,
}: {
  href?: string;
  children: React.ReactNode;
  onClick?: () => void;
}) => {
  return (
    <button type="button" className="link-button" onClick={onClick}>
      <FilledButton>{children}</FilledButton>
    </button>
  );
};
