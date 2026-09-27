// The browser result page is served by Desktop, outside the renderer's locale
// runtime. Keep its copy aligned with the eight production locales in
// locales/manifest.json.
export const PAGE_COPY = {
  en: {
    returnButton: "Return to PuppyOne Desktop",
    success: ["Signed in successfully", "PuppyOne Desktop is ready to use.", "You can close this browser tab."],
    unrecognized: ["Sign-in link not recognized", "This page is not part of an active PuppyOne Desktop sign-in.", "Return to the app and start sign-in again."],
    notReady: ["Sign-in is not ready", "PuppyOne Desktop is still preparing the sign-in request.", "Return to the app and try again."],
    alreadyUsed: ["Sign-in link already used", "This sign-in link can only be opened once.", "If you're not signed in, return to the app and try again."],
    stateMismatch: ["Sign-in could not be verified", "This page does not match the sign-in request from PuppyOne Desktop.", "Return to the app and start sign-in again."],
    failed: ["Sign-in did not finish", "PuppyOne Desktop could not complete sign-in.", "Return to the app and try again."],
  },
  es: {
    returnButton: "Volver a PuppyOne Desktop",
    success: ["Sesión iniciada correctamente", "PuppyOne Desktop está listo para usarse.", "Puedes cerrar esta pestaña del navegador."],
    unrecognized: ["Enlace de inicio de sesión no reconocido", "Esta página no corresponde a un inicio de sesión activo de PuppyOne Desktop.", "Vuelve a la aplicación e inicia sesión de nuevo."],
    notReady: ["El inicio de sesión aún no está listo", "PuppyOne Desktop está preparando la solicitud de inicio de sesión.", "Vuelve a la aplicación e inténtalo de nuevo."],
    alreadyUsed: ["Enlace de inicio de sesión ya utilizado", "Este enlace de inicio de sesión solo puede abrirse una vez.", "Si aún no has iniciado sesión, vuelve a la aplicación e inténtalo de nuevo."],
    stateMismatch: ["No se pudo verificar el inicio de sesión", "Esta página no coincide con la solicitud de inicio de sesión de PuppyOne Desktop.", "Vuelve a la aplicación e inicia sesión de nuevo."],
    failed: ["No se completó el inicio de sesión", "PuppyOne Desktop no pudo completar el inicio de sesión.", "Vuelve a la aplicación e inténtalo de nuevo."],
  },
  "pt-BR": {
    returnButton: "Voltar ao PuppyOne Desktop",
    success: ["Login realizado com sucesso", "O PuppyOne Desktop está pronto para uso.", "Você pode fechar esta aba do navegador."],
    unrecognized: ["Link de login não reconhecido", "Esta página não faz parte de um login ativo do PuppyOne Desktop.", "Volte ao aplicativo e inicie o login novamente."],
    notReady: ["O login ainda não está pronto", "O PuppyOne Desktop ainda está preparando a solicitação de login.", "Volte ao aplicativo e tente novamente."],
    alreadyUsed: ["Link de login já utilizado", "Este link de login só pode ser aberto uma vez.", "Se você ainda não entrou, volte ao aplicativo e tente novamente."],
    stateMismatch: ["Não foi possível verificar o login", "Esta página não corresponde à solicitação de login do PuppyOne Desktop.", "Volte ao aplicativo e inicie o login novamente."],
    failed: ["O login não foi concluído", "O PuppyOne Desktop não conseguiu concluir o login.", "Volte ao aplicativo e tente novamente."],
  },
  fr: {
    returnButton: "Revenir à PuppyOne Desktop",
    success: ["Connexion réussie", "PuppyOne Desktop est prêt à être utilisé.", "Vous pouvez fermer cet onglet du navigateur."],
    unrecognized: ["Lien de connexion non reconnu", "Cette page ne correspond à aucune connexion active à PuppyOne Desktop.", "Retournez dans l’application et recommencez la connexion."],
    notReady: ["La connexion n’est pas encore prête", "PuppyOne Desktop prépare encore la demande de connexion.", "Retournez dans l’application et réessayez."],
    alreadyUsed: ["Lien de connexion déjà utilisé", "Ce lien de connexion ne peut être ouvert qu’une seule fois.", "Si vous n’êtes pas connecté, retournez dans l’application et réessayez."],
    stateMismatch: ["Connexion impossible à vérifier", "Cette page ne correspond pas à la demande de connexion de PuppyOne Desktop.", "Retournez dans l’application et recommencez la connexion."],
    failed: ["Connexion non terminée", "PuppyOne Desktop n’a pas pu terminer la connexion.", "Retournez dans l’application et réessayez."],
  },
  de: {
    returnButton: "Zurück zu PuppyOne Desktop",
    success: ["Anmeldung erfolgreich", "PuppyOne Desktop ist einsatzbereit.", "Du kannst diesen Browser-Tab schließen."],
    unrecognized: ["Anmeldelink nicht erkannt", "Diese Seite gehört zu keiner aktiven Anmeldung bei PuppyOne Desktop.", "Kehre zur App zurück und starte die Anmeldung erneut."],
    notReady: ["Anmeldung noch nicht bereit", "PuppyOne Desktop bereitet die Anmeldung noch vor.", "Kehre zur App zurück und versuche es erneut."],
    alreadyUsed: ["Anmeldelink bereits verwendet", "Dieser Anmeldelink kann nur einmal geöffnet werden.", "Falls du noch nicht angemeldet bist, kehre zur App zurück und versuche es erneut."],
    stateMismatch: ["Anmeldung konnte nicht bestätigt werden", "Diese Seite passt nicht zur Anmeldeanfrage von PuppyOne Desktop.", "Kehre zur App zurück und starte die Anmeldung erneut."],
    failed: ["Anmeldung nicht abgeschlossen", "PuppyOne Desktop konnte die Anmeldung nicht abschließen.", "Kehre zur App zurück und versuche es erneut."],
  },
  ja: {
    returnButton: "PuppyOne Desktop に戻る",
    success: ["ログインが完了しました", "PuppyOne Desktop を使用できます。", "このブラウザーのタブは閉じてもかまいません。"],
    unrecognized: ["ログインリンクを確認できません", "このページは有効な PuppyOne Desktop のログイン操作に含まれていません。", "アプリに戻ってログインをやり直してください。"],
    notReady: ["ログインの準備ができていません", "PuppyOne Desktop はログインの準備中です。", "アプリに戻ってもう一度お試しください。"],
    alreadyUsed: ["ログインリンクは使用済みです", "このログインリンクは一度しか開けません。", "まだログインしていない場合は、アプリに戻ってやり直してください。"],
    stateMismatch: ["ログインを確認できません", "このページは PuppyOne Desktop のログイン要求と一致しません。", "アプリに戻ってログインをやり直してください。"],
    failed: ["ログインが完了しませんでした", "PuppyOne Desktop でログインを完了できませんでした。", "アプリに戻ってもう一度お試しください。"],
  },
  ko: {
    returnButton: "PuppyOne Desktop으로 돌아가기",
    success: ["로그인 완료", "PuppyOne Desktop을 사용할 준비가 되었습니다.", "이 브라우저 탭을 닫아도 됩니다."],
    unrecognized: ["로그인 링크를 확인할 수 없습니다", "이 페이지는 진행 중인 PuppyOne Desktop 로그인 요청에 속하지 않습니다.", "앱으로 돌아가 로그인을 다시 시작하세요."],
    notReady: ["로그인 준비가 끝나지 않았습니다", "PuppyOne Desktop이 로그인 요청을 준비하고 있습니다.", "앱으로 돌아가 다시 시도하세요."],
    alreadyUsed: ["이미 사용한 로그인 링크입니다", "이 로그인 링크는 한 번만 열 수 있습니다.", "아직 로그인하지 않았다면 앱으로 돌아가 다시 시도하세요."],
    stateMismatch: ["로그인을 확인할 수 없습니다", "이 페이지는 PuppyOne Desktop의 로그인 요청과 일치하지 않습니다.", "앱으로 돌아가 로그인을 다시 시작하세요."],
    failed: ["로그인이 완료되지 않았습니다", "PuppyOne Desktop에서 로그인을 완료할 수 없습니다.", "앱으로 돌아가 다시 시도하세요."],
  },
  "zh-Hans": {
    returnButton: "返回 PuppyOne Desktop",
    success: ["登录成功", "PuppyOne Desktop 已准备就绪。", "你可以关闭这个浏览器标签页。"],
    unrecognized: ["无法识别登录链接", "此页面不属于当前的 PuppyOne Desktop 登录请求。", "请返回应用重新发起登录。"],
    notReady: ["登录尚未准备好", "PuppyOne Desktop 正在准备登录请求。", "请返回应用重试。"],
    alreadyUsed: ["登录链接已使用", "此登录链接只能使用一次。", "如果应用中尚未登录，请返回应用重试。"],
    stateMismatch: ["无法验证登录", "此页面与 PuppyOne Desktop 发起的登录请求不匹配。", "请返回应用重新发起登录。"],
    failed: ["登录未完成", "PuppyOne Desktop 未能完成登录。", "请返回应用重试。"],
  },
};

export function resolveCallbackLocale(appLocale, acceptLanguage) {
  const selected = matchLocale(appLocale);
  if (selected) return selected;
  const candidates = String(acceptLanguage || "").split(",").map((entry, index) => {
    const [tag, quality] = entry.trim().split(";");
    const q = quality?.match(/^q=([01](?:\.\d{0,3})?)$/i)?.[1];
    return { tag, weight: q === undefined ? 1 : Number(q), index };
  }).sort((left, right) => right.weight - left.weight || left.index - right.index);
  for (const { tag, weight } of candidates) {
    if (weight <= 0) continue;
    const locale = matchLocale(tag);
    if (locale) return locale;
  }
  return "en";
}

function matchLocale(raw) {
  const tag = String(raw || "").trim().replaceAll("_", "-").toLowerCase();
  if (tag === "zh" || tag.startsWith("zh-hans") || tag.startsWith("zh-cn") || tag.startsWith("zh-sg")) return "zh-Hans";
  if (tag === "pt" || tag.startsWith("pt-")) return "pt-BR";
  for (const locale of ["en", "es", "fr", "de", "ja", "ko"]) {
    if (tag === locale || tag.startsWith(`${locale}-`)) return locale;
  }
  return null;
}
