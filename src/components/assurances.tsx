import { Icon, type IconName } from "../ui/icons";

const ITEMS: { icon: IconName; title: string; body: string }[] = [
  { icon: "lock", title: "Encrypted here", body: "AES-256-GCM runs in this tab, before anything is sent." },
  { icon: "key", title: "The key never travels", body: "It lives after the # in the link, which browsers keep to themselves." },
  { icon: "flame", title: "Burned on the last view", body: "The ciphertext is deleted before it is even delivered." },
  { icon: "clock", title: "Expires regardless", body: "Unopened secrets die on their own when their time is up." },
];

/** El modelo de seguridad, en cuatro líneas que caben de un vistazo. */
export function Assurances() {
  return (
    <ul className="assurances" aria-label="Security model">
      {ITEMS.map((item) => (
        <li key={item.title} className="assurance">
          <Icon name={item.icon} size={17} />
          <div>
            <strong>{item.title}</strong>
            <span>{item.body}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
