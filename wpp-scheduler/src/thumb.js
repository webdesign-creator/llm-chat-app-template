/**
 * Extração da imagem (thumbnail) a partir do link do produto.
 *
 * Prioridade do sistema: usar a imagem do próprio link (og:image). Se não der
 * (link sem meta, bloqueio, timeout), o app cai para a imagem colada.
 */

/** Primeiro link http(s) encontrado no texto. */
export function firstUrl(text) {
	const m = (text || "").match(/https?:\/\/[^\s]+/);
	return m ? m[0].replace(/[)\].,]+$/, "") : null;
}

/** Torna a URL absoluta em relação à página de origem. */
function absolutize(src, base) {
	try {
		return new URL(src, base).toString();
	} catch {
		return src;
	}
}

/**
 * Busca a thumbnail de uma página seguindo redirecionamentos e lendo as metas
 * og:image / twitter:image. Retorna a URL da imagem ou `null`.
 */
export async function fetchThumb(pageUrl) {
	try {
		const res = await fetch(pageUrl, {
			redirect: "follow",
			headers: {
				"user-agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
				accept: "text/html,application/xhtml+xml",
			},
			signal: AbortSignal.timeout(9000),
		});
		if (!res.ok) return null;
		const html = (await res.text()).slice(0, 600000);
		const patterns = [
			/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i,
			/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
			/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
			/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
		];
		for (const p of patterns) {
			const m = html.match(p);
			if (m && m[1]) return absolutize(m[1].trim(), res.url || pageUrl);
		}
		return null;
	} catch {
		return null;
	}
}
