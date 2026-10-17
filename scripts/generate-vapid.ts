/** Génère une paire de clés VAPID pour les notifications sur téléphone : `npm run vapid`. À copier dans l'environnement du serveur. */
import webpush from "web-push";

const k = webpush.generateVAPIDKeys();
console.log(`VAPID_PUBLIC_KEY=${k.publicKey}\nVAPID_PRIVATE_KEY=${k.privateKey}\nVAPID_SUBJECT=mailto:vous@exemple.fr`);
