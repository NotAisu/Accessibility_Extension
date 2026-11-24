type Props = {
  children: React.ReactNode;
};

export default function Container({ children }: Props) {
  return <div aria-live="loud" className="container mx-auto px-5">{children}</div>;
}
