import { NextResponse } from "next/server";

import { careonOAuthOrigin, isMicrosoftLoginEnabled } from "@/lib/supabase/oauth.server";
import { supabaseServer } from "@/lib/supabase/server";

export const runtime = "nodejs";

/** Start de Supabase PKCE-flow. De browser praat alleen met onze eigen origin;
    Supabase genereert de authorize-URL en bewaart de code verifier in een
    HttpOnly-cookie via de bestaande @supabase/ssr-serverclient. */
export async function GET(request: Request) {
  if (!isMicrosoftLoginEnabled()) {
    return NextResponse.json({ error: "Microsoft-inloggen is nog niet geactiveerd." }, { status: 503 });
  }
  const origin = careonOAuthOrigin(request);
  const prompt = new URL(request.url).searchParams.get("prompt");
  const queryParams = prompt === "select_account" ? { prompt } : undefined;
  const supabase = await supabaseServer();
  if (!origin || !supabase) {
    return NextResponse.json({ error: "Authenticatie is niet volledig geconfigureerd." }, { status: 503 });
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "azure",
    options: {
      // Supabase vereist email voor veilige automatische identity linking.
      // Office-datarechten horen nadrukkelijk NIET in deze login-app; YAAZ
      // vraagt die later via zijn eigen Graph-consentregistratie.
      scopes: "openid profile email",
      redirectTo: `${origin}/api/auth/callback`,
      queryParams,
      skipBrowserRedirect: true,
    },
  });

  if (error || !data.url) {
    console.error("Microsoft login start failed", { code: error?.code ?? "missing_authorize_url" });
    return NextResponse.redirect(`${origin}/auth/v1/login?error=microsoft-unavailable`, 303);
  }
  return NextResponse.redirect(data.url, 303);
}
