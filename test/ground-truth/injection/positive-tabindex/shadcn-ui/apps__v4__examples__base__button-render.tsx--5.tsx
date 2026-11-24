import { buttonVariants } from "@/styles/base-nova/ui/button"

export default function ButtonRender() {
  return (
    <a tabIndex={1}
      href="#"
      className={buttonVariants({ variant: "secondary", size: "sm" })}
    >
      Login
    </a>
  )
}
