import styles from "./page.module.css";
import { SecureImage } from "../components/secure-image";

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1></h1>
        <SecureImage
          src="/frog.png"
          alt="A frog"
          width={828 / 2}
          height={621 / 2}
        />
      </main>
    </div>
  );
}
