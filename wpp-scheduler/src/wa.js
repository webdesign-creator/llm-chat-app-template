/**
 * Conexão com o WhatsApp via Baileys (WhatsApp Web não-oficial).
 *
 * - Guarda a sessão em ./auth (escaneia o QR só na primeira vez).
 * - Reconecta sozinho se cair (a não ser que a sessão seja deslogada).
 * - Expõe: estado da conexão, QR atual (para o painel), lista de grupos e envio.
 */
import makeWASocket, {
	useMultiFileAuthState,
	DisconnectReason,
	fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import QRCode from "qrcode";
import pino from "pino";
import { join } from "node:path";

const logger = pino({ level: "silent" });
// A sessão do WhatsApp fica no disco persistente (DATA_DIR/auth), para
// escanear o QR só uma vez, mesmo após reinícios/deploys.
const DATA_DIR = process.env.DATA_DIR || new URL("..", import.meta.url).pathname;
const AUTH_DIR = join(DATA_DIR, "auth");

class WhatsApp {
	constructor() {
		this.sock = null;
		this.connected = false;
		this.qrDataUrl = null; // QR em imagem (data URL) para o painel
		this.me = null; // dados da conta conectada
		this.loggedOut = false;
		this.starting = false;
	}

	async start() {
		if (this.starting) return;
		this.starting = true;
		const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
		const { version } = await fetchLatestBaileysVersion();

		this.sock = makeWASocket({
			version,
			auth: state,
			logger,
			browser: ["Ofertas Scheduler", "Chrome", "1.0.0"],
			syncFullHistory: false,
		});

		this.sock.ev.on("creds.update", saveCreds);

		this.sock.ev.on("connection.update", async (update) => {
			const { connection, lastDisconnect, qr } = update;
			if (qr) {
				this.qrDataUrl = await QRCode.toDataURL(qr);
				this.connected = false;
			}
			if (connection === "open") {
				this.connected = true;
				this.qrDataUrl = null;
				this.loggedOut = false;
				this.me = this.sock.user || null;
				console.log("✅ WhatsApp conectado:", this.me?.id);
			}
			if (connection === "close") {
				this.connected = false;
				const code = lastDisconnect?.error?.output?.statusCode;
				if (code === DisconnectReason.loggedOut) {
					// Sessão encerrada: precisa escanear o QR de novo.
					this.loggedOut = true;
					this.me = null;
					console.warn("⚠️ WhatsApp deslogado — escaneie o QR novamente.");
				} else {
					console.warn("🔄 Conexão caiu, reconectando…", code);
					this.starting = false;
					setTimeout(() => this.start().catch(console.error), 2000);
				}
			}
		});

		this.starting = false;
	}

	status() {
		return {
			connected: this.connected,
			loggedOut: this.loggedOut,
			qr: this.qrDataUrl,
			me: this.me ? { id: this.me.id, name: this.me.name } : null,
		};
	}

	/** Lista os grupos em que a conta participa. */
	async groups() {
		if (!this.connected) return [];
		const map = await this.sock.groupFetchAllParticipating();
		return Object.values(map)
			.map((g) => ({ jid: g.id, name: g.subject }))
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	/**
	 * Envia uma mensagem para um grupo. A imagem pode vir por URL (`imageUrl`,
	 * ex.: thumb do link do produto) ou por dados colados (`imageData`, data URL
	 * base64). O texto vira legenda quando há imagem. Sem imagem, envia só texto.
	 * Os asteriscos do WhatsApp (*negrito*, ~riscado~, _itálico_) são preservados.
	 */
	async send({ groupJid, text, imageUrl, imageData }) {
		if (!this.connected) throw new Error("WhatsApp não está conectado.");
		const caption = text || "";
		if (imageUrl) {
			await this.sock.sendMessage(groupJid, { image: { url: imageUrl }, caption });
		} else if (imageData) {
			const base64 = String(imageData).split(",").pop();
			await this.sock.sendMessage(groupJid, { image: Buffer.from(base64, "base64"), caption });
		} else {
			await this.sock.sendMessage(groupJid, { text: caption });
		}
	}

	/** Encerra a sessão (logout) — apaga a necessidade de reusar o número. */
	async logout() {
		try {
			await this.sock?.logout();
		} catch {
			/* ignore */
		}
		this.connected = false;
		this.me = null;
		this.loggedOut = true;
	}
}

export const wa = new WhatsApp();
