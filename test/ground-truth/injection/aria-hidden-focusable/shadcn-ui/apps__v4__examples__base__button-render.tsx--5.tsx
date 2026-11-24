import { buttonVariants } from "@/styles/base-nova/ui/button"

export default function ButtonRender() {
  return (
    <a aria-hidden="true"
      href="#"
      className={buttonVariants({ variant: "secondary", size: "sm" })}
    >
      Login
    </a>
  )
}
