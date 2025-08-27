require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const webpush = require("web-push");
const sqlite3 = require("sqlite3").verbose();

const app = express();
app.use(bodyParser.json());
app.use(express.static("public"));

const db = new sqlite3.Database("./subscriptions.db");
db.run(`
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL
)
`);

webpush.setVapidDetails(
  "mailto:test@example.com",
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// Auth basique pour admin
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "motdepasse123";
app.use("/admin.html", (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).send("Non autorisé");

  const token = auth.split(" ")[1];
  const [user, pass] = Buffer.from(token, "base64").toString().split(":");

  if (pass === ADMIN_PASSWORD) next();
  else res.status(403).send("Mot de passe incorrect");
});

// Enregistrement abonnement avec ID automatique
app.post("/subscribe", (req, res) => {
  const { subscription } = req.body;
  const { endpoint, keys } = subscription;
  const id = Math.random().toString(36).substring(2, 12);

  db.run(
    `INSERT INTO subscriptions (id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)`,
    [id, endpoint, keys.p256dh, keys.auth],
    function (err) {
      if (err) return res.status(500).json({ success: false });
      res.status(201).json({ success: true, id });
    }
  );
});

// Envoyer notification générique
app.post("/send-notification", (req, res) => {
  const payload = JSON.stringify({ title: "Nouvelle notification", body: "Ceci est un test depuis la PWA" });
  sendToAll(payload, res);
});

// Envoyer notification personnalisée depuis admin
app.post("/send-notification-custom", (req, res) => {
  const { title, body } = req.body;
  if (!title || !body) return res.status(400).json({ success: false, message: "Titre et message requis" });
  const payload = JSON.stringify({ title, body });
  sendToAll(payload, res);
});

// Fonction pour envoyer à tous
function sendToAll(payload, res) {
  db.all(`SELECT * FROM subscriptions`, [], (err, rows) => {
    if (err) return res.status(500).json({ success: false });

    const sendPromises = rows.map(sub => {
      const subscription = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
      return webpush.sendNotification(subscription, payload);
    });

    Promise.all(sendPromises)
      .then(() => res.json({ success: true }))
      .catch(err => { console.error(err); res.status(500).json({ success: false }); });
  });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur démarré sur https://localhost:${PORT}`));
