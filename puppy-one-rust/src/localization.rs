//! Session-only projection of production catalogs, not another translation
//! authority or a replacement for the product's persisted locale service.
//!
//! Messages use the ICU subset that the product catalogs actually contain:
//! `{arg}`, `{arg, number}`, `{arg, plural, =N {…} one {…} other {…}}` with `#`
//! and `{arg, select, key {…} other {…}}`.
use serde_json::Value;
use std::sync::OnceLock;

fn data() -> &'static Value {
    static DATA: OnceLock<Value> = OnceLock::new();
    DATA.get_or_init(|| {
        let mut data: Value = serde_json::from_str(include_str!("../assets/locales.json"))
            .expect("generated catalogs");
        // Copy ahead of the v0.4.4 pin, each projected from one qubits commit
        // with per-file SHA-256 hashes: CloudSignInDialog
        // (`tools/import-sign-in-explainer.py`), first run's moments
        // (`tools/import-onboarding-value.py`), Projects Home
        // (`tools/import-onboarding-home.py`), Cloud Computer Screen
        // (`tools/import-cloud-computer-screen.py`), Computer Mode
        // (`tools/import-computer-mode.py`) and the HTML visual editor's
        // block and link controls (`tools/import-html-visual-copy.py`).
        let ahead = [
            include_str!("../assets/sign-in-explainer.json"),
            include_str!("../assets/onboarding-value.json"),
            include_str!("../assets/onboarding-home.json"),
            include_str!("../assets/cloud-computer-screen.json"),
            include_str!("../assets/computer-mode.json"),
            include_str!("../assets/html-visual-copy.json"),
        ]
        .map(|source| serde_json::from_str::<Value>(source).expect("catalog ahead of the pin"));
        for (locale, messages) in ahead.iter().flat_map(|a| a["locales"].as_object().unwrap()) {
            data["catalogs"][locale]
                .as_object_mut()
                .unwrap()
                .extend(messages.as_object().unwrap().clone());
        }
        data
    })
}

/// Native-only messages for capabilities the product does not have; product
/// catalogs always take precedence.
fn native() -> &'static Value {
    static DATA: OnceLock<Value> = OnceLock::new();
    DATA.get_or_init(|| {
        let mut data: Value = serde_json::from_str(include_str!("../assets/native-locales.json"))
            .expect("native catalogs");
        for raw in [
            DOCUMENT_RECONCILE_MESSAGES,
            CROSS_PLATFORM_MESSAGES,
            ISOLATED_AGENT_SANDBOXES_MESSAGES,
        ] {
            let extra: Value = serde_json::from_str(raw).expect("native extension catalogs");
            for (locale, messages) in extra.as_object().unwrap() {
                if let Some(target) = data["catalogs"][locale].as_object_mut() {
                    target.extend(messages.as_object().unwrap().clone());
                }
            }
        }
        data
    })
}

const ISOLATED_AGENT_SANDBOXES_MESSAGES: &str = r#"{
  "en": {
    "settings.experimental.isolatedAgentSandboxes.title": "Isolated Agent sandboxes",
    "settings.experimental.isolatedAgentSandboxes.detail": "Show a per-project switch in Cloud Computer settings to run each external Agent in its own isolated sandbox mounted onto the shared workspace.",
    "cloud.settings.computer.isolatedAgents": "Isolated Agent sandboxes",
    "cloud.settings.computer.isolatedAgentsHelp": "Run each external Agent in its own isolated sandbox mounted onto this project's shared files. Applies to new Agent connections."
  },
  "es": {
    "settings.experimental.isolatedAgentSandboxes.title": "Sandboxes aislados para Agents",
    "settings.experimental.isolatedAgentSandboxes.detail": "Muestra un interruptor por proyecto en la configuración de Cloud Computer para ejecutar cada Agent externo en su propio sandbox aislado montado sobre el espacio compartido.",
    "cloud.settings.computer.isolatedAgents": "Sandboxes aislados para Agents",
    "cloud.settings.computer.isolatedAgentsHelp": "Ejecuta cada Agent externo en su propio sandbox aislado montado sobre los archivos compartidos del proyecto. Se aplica a nuevas conexiones."
  },
  "pt-BR": {
    "settings.experimental.isolatedAgentSandboxes.title": "Sandboxes isolados para Agents",
    "settings.experimental.isolatedAgentSandboxes.detail": "Mostra uma opção por projeto nas configurações do Cloud Computer para executar cada Agent externo em seu próprio sandbox isolado montado no workspace compartilhado.",
    "cloud.settings.computer.isolatedAgents": "Sandboxes isolados para Agents",
    "cloud.settings.computer.isolatedAgentsHelp": "Executa cada Agent externo em seu próprio sandbox isolado montado nos arquivos compartilhados do projeto. Aplica-se a novas conexões."
  },
  "fr": {
    "settings.experimental.isolatedAgentSandboxes.title": "Sandboxes isolés pour Agents",
    "settings.experimental.isolatedAgentSandboxes.detail": "Affiche une option par projet dans les paramètres Cloud Computer pour exécuter chaque Agent externe dans son propre sandbox isolé monté sur l'espace partagé.",
    "cloud.settings.computer.isolatedAgents": "Sandboxes isolés pour Agents",
    "cloud.settings.computer.isolatedAgentsHelp": "Exécute chaque Agent externe dans son propre sandbox isolé monté sur les fichiers partagés du projet. S'applique aux nouvelles connexions."
  },
  "de": {
    "settings.experimental.isolatedAgentSandboxes.title": "Isolierte Agent-Sandboxes",
    "settings.experimental.isolatedAgentSandboxes.detail": "Zeigt in den Cloud-Computer-Einstellungen einen projektspezifischen Schalter, um jeden externen Agent in einer eigenen isolierten Sandbox mit geteiltem Workspace auszuführen.",
    "cloud.settings.computer.isolatedAgents": "Isolierte Agent-Sandboxes",
    "cloud.settings.computer.isolatedAgentsHelp": "Führt jeden externen Agent in einer eigenen isolierten Sandbox aus, die auf die geteilten Projektdateien eingehängt ist. Gilt für neue Verbindungen."
  },
  "ja": {
    "settings.experimental.isolatedAgentSandboxes.title": "分離された Agent サンドボックス",
    "settings.experimental.isolatedAgentSandboxes.detail": "クラウドコンピューター設定にプロジェクト単位のスイッチを表示し、外部 Agent ごとに独立したサンドボックスから共有ワークスペースをマウントします。",
    "cloud.settings.computer.isolatedAgents": "分離された Agent サンドボックス",
    "cloud.settings.computer.isolatedAgentsHelp": "外部 Agent ごとに独立したサンドボックスを起動し、プロジェクトの共有ファイルをマウントします。次の接続から適用されます。"
  },
  "ko": {
    "settings.experimental.isolatedAgentSandboxes.title": "격리된 Agent 샌드박스",
    "settings.experimental.isolatedAgentSandboxes.detail": "클라우드 컴퓨터 설정에 프로젝트별 스위치를 표시하여 각 외부 Agent가 공유 워크스페이스를 마운트한 독립 샌드박스에서 실행되도록 합니다.",
    "cloud.settings.computer.isolatedAgents": "격리된 Agent 샌드박스",
    "cloud.settings.computer.isolatedAgentsHelp": "각 외부 Agent를 프로젝트 공유 파일이 마운트된 독립 샌드박스에서 실행합니다. 새 Agent 연결부터 적용됩니다."
  },
  "zh-Hans": {
    "settings.experimental.isolatedAgentSandboxes.title": "外部 Agent 独立沙盒",
    "settings.experimental.isolatedAgentSandboxes.detail": "在云电脑设置中显示项目级开关，让每个外部 Agent 在独立的云端沙盒中运行，并挂载共享工作区文件。",
    "cloud.settings.computer.isolatedAgents": "外部 Agent 独立沙盒",
    "cloud.settings.computer.isolatedAgentsHelp": "为每个外部 Agent 启动独立沙盒并挂载项目共享文件。开启后对后续外部 Agent 连接生效。"
  }
}"#;

const CROSS_PLATFORM_MESSAGES: &str = r#"{
  "en": {
    "native.desktop.showInExplorer": "Show in Explorer",
    "native.desktop.showInFiles": "Show in Files",
    "native.credentials.unavailable": "System credential storage is not available. Install or start a desktop keyring service (for example GNOME Keyring or KWallet) and try again.",
    "native.credentials.locked": "System credential storage is locked. Unlock your desktop keyring and try again.",
    "native.web.embeddedUnavailable": "Embedded web preview is not available on this platform.",
    "native.web.openInBrowser": "Open in browser",
    "native.web.openExternally": "Open with default app",
    "native.web.viewSource": "View source",
    "native.window.minimize": "Minimize",
    "native.window.maximize": "Maximize",
    "native.window.restore": "Restore",
    "native.window.close": "Close",
    "native.window.menu": "Menu"
  },
  "zh-Hans": {
    "native.desktop.showInExplorer": "在资源管理器中显示",
    "native.desktop.showInFiles": "在文件管理器中显示",
    "native.credentials.unavailable": "系统凭据存储不可用。请安装或启动桌面密钥环服务（如 GNOME Keyring 或 KWallet）后重试。",
    "native.credentials.locked": "系统凭据存储已锁定。请先解锁桌面密钥环后重试。",
    "native.web.embeddedUnavailable": "当前平台暂不支持内嵌网页预览。",
    "native.web.openInBrowser": "在浏览器中打开",
    "native.web.openExternally": "使用默认应用打开",
    "native.web.viewSource": "查看源码",
    "native.window.minimize": "最小化",
    "native.window.maximize": "最大化",
    "native.window.restore": "还原",
    "native.window.close": "关闭",
    "native.window.menu": "菜单"
  },
  "ja": {
    "native.desktop.showInExplorer": "エクスプローラーで表示",
    "native.desktop.showInFiles": "ファイルマネージャーで表示",
    "native.credentials.unavailable": "システムの資格情報ストレージを利用できません。デスクトップのキーリングサービスを起動してから再試行してください。",
    "native.credentials.locked": "システムの資格情報ストレージがロックされています。ロックを解除してから再試行してください。",
    "native.web.embeddedUnavailable": "このプラットフォームでは組み込み Web プレビューを利用できません。",
    "native.web.openInBrowser": "ブラウザーで開く",
    "native.web.openExternally": "既定のアプリで開く",
    "native.web.viewSource": "ソースを表示",
    "native.window.minimize": "最小化",
    "native.window.maximize": "最大化",
    "native.window.restore": "元に戻す",
    "native.window.close": "閉じる",
    "native.window.menu": "メニュー"
  },
  "ko": {
    "native.desktop.showInExplorer": "탐색기에서 표시",
    "native.desktop.showInFiles": "파일 관리자에서 표시",
    "native.credentials.unavailable": "시스템 자격 증명 저장소를 사용할 수 없습니다. 데스크톱 키링 서비스를 설치하거나 시작한 후 다시 시도하세요.",
    "native.credentials.locked": "시스템 자격 증명 저장소가 잠겨 있습니다. 데스크톱 키링의 잠금을 해제한 후 다시 시도하세요.",
    "native.web.embeddedUnavailable": "이 플랫폼에서는 내장 웹 미리 보기를 사용할 수 없습니다.",
    "native.web.openInBrowser": "브라우저에서 열기",
    "native.web.openExternally": "기본 앱으로 열기",
    "native.web.viewSource": "소스 보기",
    "native.window.minimize": "최소화",
    "native.window.maximize": "최대화",
    "native.window.restore": "복원",
    "native.window.close": "닫기",
    "native.window.menu": "메뉴"
  },
  "es": {
    "native.desktop.showInExplorer": "Mostrar en el Explorador",
    "native.desktop.showInFiles": "Mostrar en Archivos",
    "native.credentials.unavailable": "El almacenamiento de credenciales del sistema no está disponible. Inicia un servicio de llavero de escritorio e inténtalo de nuevo.",
    "native.credentials.locked": "El almacenamiento de credenciales del sistema está bloqueado. Desbloquea tu llavero de escritorio e inténtalo de nuevo.",
    "native.web.embeddedUnavailable": "La vista previa web integrada no está disponible en esta plataforma.",
    "native.web.openInBrowser": "Abrir en el navegador",
    "native.web.openExternally": "Abrir con la aplicación predeterminada",
    "native.web.viewSource": "Ver código fuente",
    "native.window.minimize": "Minimizar",
    "native.window.maximize": "Maximizar",
    "native.window.restore": "Restaurar",
    "native.window.close": "Cerrar",
    "native.window.menu": "Menú"
  },
  "pt-BR": {
    "native.desktop.showInExplorer": "Mostrar no Explorador",
    "native.desktop.showInFiles": "Mostrar em Arquivos",
    "native.credentials.unavailable": "O armazenamento de credenciais do sistema não está disponível. Inicie um serviço de chaveiro da área de trabalho e tente novamente.",
    "native.credentials.locked": "O armazenamento de credenciais do sistema está bloqueado. Desbloqueie seu chaveiro e tente novamente.",
    "native.web.embeddedUnavailable": "A visualização da web incorporada não está disponível nesta plataforma.",
    "native.web.openInBrowser": "Abrir no navegador",
    "native.web.openExternally": "Abrir com o aplicativo padrão",
    "native.web.viewSource": "Ver código-fonte",
    "native.window.minimize": "Minimizar",
    "native.window.maximize": "Maximizar",
    "native.window.restore": "Restaurar",
    "native.window.close": "Fechar",
    "native.window.menu": "Menu"
  },
  "fr": {
    "native.desktop.showInExplorer": "Afficher dans l’Explorateur",
    "native.desktop.showInFiles": "Afficher dans Fichiers",
    "native.credentials.unavailable": "Le stockage d’identifiants système n’est pas disponible. Démarrez un service de trousseau de bureau et réessayez.",
    "native.credentials.locked": "Le stockage d’identifiants système est verrouillé. Déverrouillez votre trousseau et réessayez.",
    "native.web.embeddedUnavailable": "L’aperçu web intégré n’est pas disponible sur cette plateforme.",
    "native.web.openInBrowser": "Ouvrir dans le navigateur",
    "native.web.openExternally": "Ouvrir avec l’application par défaut",
    "native.web.viewSource": "Voir le code source",
    "native.window.minimize": "Réduire",
    "native.window.maximize": "Agrandir",
    "native.window.restore": "Restaurer",
    "native.window.close": "Fermer",
    "native.window.menu": "Menu"
  },
  "de": {
    "native.desktop.showInExplorer": "Im Explorer anzeigen",
    "native.desktop.showInFiles": "In Dateien anzeigen",
    "native.credentials.unavailable": "Der System-Anmeldeinformationsspeicher ist nicht verfügbar. Starten Sie einen Desktop-Schlüsselbunddienst und versuchen Sie es erneut.",
    "native.credentials.locked": "Der System-Anmeldeinformationsspeicher ist gesperrt. Entsperren Sie Ihren Schlüsselbund und versuchen Sie es erneut.",
    "native.web.embeddedUnavailable": "Die eingebettete Webvorschau ist auf dieser Plattform nicht verfügbar.",
    "native.web.openInBrowser": "Im Browser öffnen",
    "native.web.openExternally": "Mit Standard-App öffnen",
    "native.web.viewSource": "Quelltext anzeigen",
    "native.window.minimize": "Minimieren",
    "native.window.maximize": "Maximieren",
    "native.window.restore": "Wiederherstellen",
    "native.window.close": "Schließen",
    "native.window.menu": "Menü"
  }
}"#;

const DOCUMENT_RECONCILE_MESSAGES: &str = r#"{
  "en": {
    "native.editor.updatedFromDiskUndo": "Updated from disk — press ⌘Z to undo",
    "native.editor.undo": "Undo",
    "native.editor.conflictCompare": "Compare",
    "native.editor.conflictKeepMine": "Keep Mine",
    "native.editor.conflictAcceptRemote": "Accept Remote",
    "native.editor.conflictSaveCopy": "Save As Copy",
    "native.editor.conflictTitle": "Cloud Conflict Comparison",
    "native.editor.conflictMessage": "The Cloud file changed in overlapping sections. Choose how to resolve:",
    "native.editor.conflictMineHeader": "My Draft (Unsaved)",
    "native.editor.conflictRemoteHeader": "Remote Version (Cloud)",
    "native.editor.lineEndingsReadOnly": "Opened read-only because this file contains mixed or CR-only line endings.",
    "native.editor.normalizeLineEndingsAndEdit": "Normalize line endings and edit",
    "native.editor.draftRecovered": "Recovered unsaved draft from local journal",
    "native.editor.saveStaleLease": "Workspace access expired before saving. Reopen the project to continue.",
    "native.editor.saveOutcomeUnknown": "Workspace state changed while saving; verify the file before retrying.",
    "native.editor.saveTargetMissing": "The file no longer exists at its path. Your draft is preserved locally."
  },
  "zh-Hans": {
    "native.editor.updatedFromDiskUndo": "已从磁盘更新 — 按 ⌘Z 可撤销",
    "native.editor.undo": "撤销",
    "native.editor.conflictCompare": "比较",
    "native.editor.conflictKeepMine": "保留我的",
    "native.editor.conflictAcceptRemote": "采纳远端",
    "native.editor.conflictSaveCopy": "另存为副本",
    "native.editor.conflictTitle": "云端冲突对比",
    "native.editor.conflictMessage": "云端文件在重叠区段发生了变化，请选择处理方式：",
    "native.editor.conflictMineHeader": "我的草稿（未保存）",
    "native.editor.conflictRemoteHeader": "远端版本（云端）",
    "native.editor.lineEndingsReadOnly": "此文件包含混合换行或仅 CR 换行，已按只读方式打开。",
    "native.editor.normalizeLineEndingsAndEdit": "统一换行后编辑",
    "native.editor.draftRecovered": "已从本地草稿日志恢复未保存的草稿",
    "native.editor.saveStaleLease": "工作区授权在保存前已过期，请重新打开项目后继续。",
    "native.editor.saveOutcomeUnknown": "保存期间工作区状态发生变化，请核对文件后再重试。",
    "native.editor.saveTargetMissing": "原路径下的文件已不存在，你的草稿已在本地保留。"
  },
  "ja": {
    "native.editor.updatedFromDiskUndo": "ディスクから更新されました — ⌘Z で元に戻せます",
    "native.editor.undo": "元に戻す",
    "native.editor.conflictCompare": "比較",
    "native.editor.conflictKeepMine": "自分の変更を保持",
    "native.editor.conflictAcceptRemote": "リモートを採用",
    "native.editor.conflictSaveCopy": "コピーとして保存",
    "native.editor.conflictTitle": "クラウド競合の比較",
    "native.editor.conflictMessage": "クラウド上のファイルが重複する箇所で変更されました。解決方法を選択してください：",
    "native.editor.conflictMineHeader": "自分の下書き（未保存）",
    "native.editor.conflictRemoteHeader": "リモート版（クラウド）",
    "native.editor.lineEndingsReadOnly": "混在または CR のみの改行が含まれているため、読み取り専用で開いています。",
    "native.editor.normalizeLineEndingsAndEdit": "改行コードを統一して編集",
    "native.editor.draftRecovered": "ローカルジャーナルから未保存の下書きを復元しました",
    "native.editor.saveStaleLease": "保存前にワークスペースの権限が失効しました。プロジェクトを開き直してください。",
    "native.editor.saveOutcomeUnknown": "保存中にワークスペースの状態が変化しました。再試行する前にファイルを確認してください。",
    "native.editor.saveTargetMissing": "元のパスにファイルが存在しません。下書きはローカルに保持されています。"
  },
  "ko": {
    "native.editor.updatedFromDiskUndo": "디스크에서 업데이트됨 — 실행 취소하려면 ⌘Z를 누르세요",
    "native.editor.undo": "실행 취소",
    "native.editor.conflictCompare": "비교",
    "native.editor.conflictKeepMine": "내 변경 유지",
    "native.editor.conflictAcceptRemote": "원격 적용",
    "native.editor.conflictSaveCopy": "사본으로 저장",
    "native.editor.conflictTitle": "클라우드 충돌 비교",
    "native.editor.conflictMessage": "클라우드 파일의 겹치는 구간이 변경되었습니다. 해결 방법을 선택하세요:",
    "native.editor.conflictMineHeader": "내 초안(저장 안 됨)",
    "native.editor.conflictRemoteHeader": "원격 버전(클라우드)",
    "native.editor.lineEndingsReadOnly": "혼합 또는 CR 전용 줄바꿈이 포함되어 읽기 전용으로 열렸습니다.",
    "native.editor.normalizeLineEndingsAndEdit": "줄바꿈 통일 후 편집",
    "native.editor.draftRecovered": "로컬 저널에서 저장되지 않은 초안을 복구했습니다",
    "native.editor.saveStaleLease": "저장 전에 작업 공간 권한이 만료되었습니다. 프로젝트를 다시 열어 계속하세요.",
    "native.editor.saveOutcomeUnknown": "저장 중 작업 공간 상태가 변경되었습니다. 다시 시도하기 전에 파일을 확인하세요.",
    "native.editor.saveTargetMissing": "경로에 파일이 더 이상 존재하지 않습니다. 초안은 로컬에 보존되어 있습니다."
  },
  "es": {
    "native.editor.updatedFromDiskUndo": "Actualizado desde el disco — pulsa ⌘Z para deshacer",
    "native.editor.undo": "Deshacer",
    "native.editor.conflictCompare": "Comparar",
    "native.editor.conflictKeepMine": "Conservar lo mío",
    "native.editor.conflictAcceptRemote": "Aceptar remoto",
    "native.editor.conflictSaveCopy": "Guardar como copia",
    "native.editor.conflictTitle": "Comparación de conflicto en la nube",
    "native.editor.conflictMessage": "El archivo en la nube cambió en secciones superpuestas. Elige cómo resolverlo:",
    "native.editor.conflictMineHeader": "Mi borrador (sin guardar)",
    "native.editor.conflictRemoteHeader": "Versión remota (nube)",
    "native.editor.lineEndingsReadOnly": "Abierto en solo lectura porque este archivo contiene saltos de línea mixtos o solo CR.",
    "native.editor.normalizeLineEndingsAndEdit": "Normalizar saltos de línea y editar",
    "native.editor.draftRecovered": "Se recuperó el borrador sin guardar del registro local",
    "native.editor.saveStaleLease": "El acceso al espacio de trabajo caducó antes de guardar. Vuelve a abrir el proyecto.",
    "native.editor.saveOutcomeUnknown": "El estado del espacio de trabajo cambió al guardar; verifica el archivo antes de reintentar.",
    "native.editor.saveTargetMissing": "El archivo ya no existe en su ruta. Tu borrador se conserva localmente."
  },
  "pt-BR": {
    "native.editor.updatedFromDiskUndo": "Atualizado do disco — pressione ⌘Z para desfazer",
    "native.editor.undo": "Desfazer",
    "native.editor.conflictCompare": "Comparar",
    "native.editor.conflictKeepMine": "Manter o meu",
    "native.editor.conflictAcceptRemote": "Aceitar remoto",
    "native.editor.conflictSaveCopy": "Salvar como cópia",
    "native.editor.conflictTitle": "Comparação de conflito na nuvem",
    "native.editor.conflictMessage": "O arquivo na nuvem mudou em trechos sobrepostos. Escolha como resolver:",
    "native.editor.conflictMineHeader": "Meu rascunho (não salvo)",
    "native.editor.conflictRemoteHeader": "Versão remota (nuvem)",
    "native.editor.lineEndingsReadOnly": "Aberto somente leitura porque este arquivo contém quebras de linha mistas ou apenas CR.",
    "native.editor.normalizeLineEndingsAndEdit": "Normalizar quebras de linha e editar",
    "native.editor.draftRecovered": "Rascunho não salvo recuperado do diário local",
    "native.editor.saveStaleLease": "O acesso ao espaço de trabalho expirou antes de salvar. Reabra o projeto para continuar.",
    "native.editor.saveOutcomeUnknown": "O estado do espaço de trabalho mudou durante o salvamento; verifique o arquivo antes de tentar novamente.",
    "native.editor.saveTargetMissing": "O arquivo não existe mais no caminho original. Seu rascunho está preservado localmente."
  },
  "fr": {
    "native.editor.updatedFromDiskUndo": "Mis à jour depuis le disque — appuyez sur ⌘Z pour annuler",
    "native.editor.undo": "Annuler",
    "native.editor.conflictCompare": "Comparer",
    "native.editor.conflictKeepMine": "Garder le mien",
    "native.editor.conflictAcceptRemote": "Accepter le distant",
    "native.editor.conflictSaveCopy": "Enregistrer une copie",
    "native.editor.conflictTitle": "Comparaison du conflit Cloud",
    "native.editor.conflictMessage": "Le fichier Cloud a été modifié sur des sections qui se chevauchent. Choisissez comment résoudre :",
    "native.editor.conflictMineHeader": "Mon brouillon (non enregistré)",
    "native.editor.conflictRemoteHeader": "Version distante (Cloud)",
    "native.editor.lineEndingsReadOnly": "Ouvert en lecture seule car ce fichier contient des fins de ligne mixtes ou CR seul.",
    "native.editor.normalizeLineEndingsAndEdit": "Normaliser les fins de ligne et modifier",
    "native.editor.draftRecovered": "Brouillon non enregistré récupéré depuis le journal local",
    "native.editor.saveStaleLease": "L’accès à l’espace de travail a expiré avant l’enregistrement. Rouvrez le projet pour continuer.",
    "native.editor.saveOutcomeUnknown": "L’état de l’espace de travail a changé pendant l’enregistrement ; vérifiez le fichier avant de réessayer.",
    "native.editor.saveTargetMissing": "Le fichier n’existe plus à son emplacement. Votre brouillon est conservé localement."
  },
  "de": {
    "native.editor.updatedFromDiskUndo": "Von der Festplatte aktualisiert — ⌘Z zum Rückgängigmachen",
    "native.editor.undo": "Rückgängig",
    "native.editor.conflictCompare": "Vergleichen",
    "native.editor.conflictKeepMine": "Meins behalten",
    "native.editor.conflictAcceptRemote": "Remote übernehmen",
    "native.editor.conflictSaveCopy": "Als Kopie speichern",
    "native.editor.conflictTitle": "Cloud-Konfliktvergleich",
    "native.editor.conflictMessage": "Die Cloud-Datei wurde in überlappenden Abschnitten geändert. Wählen Sie eine Lösung:",
    "native.editor.conflictMineHeader": "Mein Entwurf (ungespeichert)",
    "native.editor.conflictRemoteHeader": "Remote-Version (Cloud)",
    "native.editor.lineEndingsReadOnly": "Schreibgeschützt geöffnet, da diese Datei gemischte oder reine CR-Zeilenenden enthält.",
    "native.editor.normalizeLineEndingsAndEdit": "Zeilenenden vereinheitlichen und bearbeiten",
    "native.editor.draftRecovered": "Ungespeicherter Entwurf aus lokalem Journal wiederhergestellt",
    "native.editor.saveStaleLease": "Der Arbeitsbereichszugriff ist vor dem Speichern abgelaufen. Öffnen Sie das Projekt erneut.",
    "native.editor.saveOutcomeUnknown": "Der Arbeitsbereichsstatus hat sich beim Speichern geändert; prüfen Sie die Datei vor einem erneuten Versuch.",
    "native.editor.saveTargetMissing": "Die Datei existiert nicht mehr am ursprünglichen Pfad. Ihr Entwurf bleibt lokal erhalten."
  }
}"#;

thread_local! {
    static CURRENT: std::cell::RefCell<String> = std::cell::RefCell::new(initial_code());
}
fn initial_code() -> String {
    std::env::var("PUPPYONE_LOCALE")
        .ok()
        .filter(|code| Locale::choices().any(|(id, _)| id == code))
        .unwrap_or_else(|| "en".into())
}
/// The shell publishes the persisted locale here; every view reads it through `t`/`tf`.
pub fn set_current(code: &str) {
    if Locale::choices().any(|(id, _)| id == code) {
        CURRENT.with(|c| *c.borrow_mut() = code.into());
    }
}
/// `resolveSystemLocale`: first OS language with a production catalog, by
/// exact tag, script (`zh-Hans`), region-less language, else English.
pub fn resolve_system(languages: &[String]) -> &'static str {
    let choices: Vec<&'static str> = Locale::choices().map(|(id, _)| id).collect();
    resolve_among(&choices, languages)
}
fn resolve_among<'a>(choices: &[&'a str], languages: &[String]) -> &'a str {
    for tag in languages {
        let tag = tag.replace('_', "-");
        if let Some(found) = choices.iter().find(|c| c.eq_ignore_ascii_case(&tag)) {
            return found;
        }
        let lower = tag.to_lowercase();
        if lower.starts_with("zh") {
            let traditional = ["hant", "tw", "hk", "mo"].iter().any(|t| lower.contains(t));
            let target = if traditional { "zh-Hant" } else { "zh-Hans" };
            if let Some(found) = choices.iter().find(|c| **c == target) {
                return found;
            }
            continue;
        }
        if lower.starts_with("pt")
            && let Some(found) = choices.iter().find(|c| c.starts_with("pt"))
        {
            return found;
        }
        let language = lower.split('-').next().unwrap_or_default();
        if let Some(found) = choices.iter().find(|c| c.to_lowercase() == language) {
            return found;
        }
    }
    "en"
}
/// The manifest's `productionReady` locales: a locale whose release flag
/// is off is neither offered nor chosen for the system.
fn ready(manifest: &Value) -> impl Iterator<Item = (&str, &str)> {
    manifest["locales"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|v| v["productionReady"].as_bool() == Some(true))
        .map(|v| (v["locale"].as_str().unwrap(), v["label"].as_str().unwrap()))
}
/// Catalog id the OS language resolves to.
pub fn system_locale() -> &'static str {
    resolve_system(crate::platform::environment::system_languages())
}
/// Resolve a stored preference (`system` or a locale id) to a catalog id.
pub fn resolve_preference(preference: &str, languages: &[String]) -> &'static str {
    Locale::choices()
        .map(|(id, _)| id)
        .find(|id| *id == preference)
        .unwrap_or_else(|| resolve_system(languages))
}
/// The calling thread's locale code (workers inherit it from their spawner).
pub fn current_code() -> String {
    CURRENT.with(|c| c.borrow().clone())
}
pub fn current() -> Locale {
    Locale {
        code: CURRENT.with(|c| c.borrow().clone()),
    }
}
/// `std::thread::spawn` for workers whose errors reach the UI: the worker
/// inherits the spawning thread's locale, since `CURRENT` is per thread.
pub fn spawn<F>(work: F) -> std::thread::JoinHandle<()>
where
    F: FnOnce() + Send + 'static,
{
    // Workers inherit the locale; a panic is recorded and contained so one
    // failing reader cannot take every window down.
    crate::platform::watchdog::spawn_contained("worker", work, |_| {})
}
/// The current locale's messages whose keys start with one of `prefixes`
/// (English where a translation is missing), for bundled product web views.
pub fn messages(prefixes: &[&str]) -> serde_json::Map<String, Value> {
    let locale = current();
    data()["catalogs"]["en"]
        .as_object()
        .into_iter()
        .flatten()
        .filter(|(key, _)| prefixes.iter().any(|p| key.starts_with(p)))
        .map(|(key, _)| (key.clone(), Value::String(locale.text(key).to_owned())))
        .collect()
}
/// `bidiIsolate(value)`: an interpolated value isolated from the message's
/// direction (U+2068 … U+2069).
pub fn bidi_isolate(value: &str) -> String {
    if value.starts_with('\u{2068}') && value.ends_with('\u{2069}') {
        return value.to_string();
    }
    format!("\u{2068}{value}\u{2069}")
}

/// How `Intl.NumberFormat` writes numbers in each product language: decimal
/// mark, group separator, the fewest integer digits that are grouped, and
/// where a currency symbol stands. `fixtures/ui/number-format-oracle.json`
/// (`tools/reference-number-format.mjs`, from Intl itself) pins them.
struct NumberStyle {
    decimal: char,
    group: char,
    min_grouped: usize,
    currency: CurrencyPosition,
}
enum CurrencyPosition {
    /// `$20`
    Before,
    /// `$ 20` (no-break space)
    BeforeSpaced,
    /// `20 $` (no-break space)
    After,
}
fn number_style(code: &str) -> NumberStyle {
    let (decimal, group, min_grouped, currency) = match code {
        // Spanish groups only five digits and more.
        "es" => (',', '.', 5, CurrencyPosition::After),
        "pt-BR" => (',', '.', 4, CurrencyPosition::BeforeSpaced),
        // A narrow no-break space.
        "fr" => (',', '\u{202f}', 4, CurrencyPosition::After),
        "de" => (',', '.', 4, CurrencyPosition::After),
        _ => ('.', ',', 4, CurrencyPosition::Before),
    };
    NumberStyle {
        decimal,
        group,
        min_grouped,
        currency,
    }
}
/// `value` at most `max` and at least `min` fraction digits, rounded half
/// away from zero on its shortest decimal form, as Intl's `halfExpand` does.
fn decimal_digits(value: f64, min: usize, max: usize) -> (bool, String, String) {
    let text = format!("{}", value.abs());
    let (int, frac) = text.split_once('.').unwrap_or((&text, ""));
    let mut digits: Vec<u8> = int.bytes().chain(frac.bytes().take(max)).collect();
    let mut int_len = int.len();
    if frac.as_bytes().get(max).is_some_and(|d| *d >= b'5') {
        let mut i = digits.len();
        loop {
            if i == 0 {
                digits.insert(0, b'1');
                int_len += 1;
                break;
            }
            i -= 1;
            if digits[i] == b'9' {
                digits[i] = b'0';
            } else {
                digits[i] += 1;
                break;
            }
        }
    }
    let int = String::from_utf8(digits[..int_len].to_vec()).unwrap_or_default();
    let mut frac = String::from_utf8(digits[int_len..].to_vec()).unwrap_or_default();
    while frac.len() > min && frac.ends_with('0') {
        frac.pop();
    }
    while frac.len() < min {
        frac.push('0');
    }
    (value.is_sign_negative(), int, frac)
}
fn grouped(int: &str, style: &NumberStyle) -> String {
    if int.len() < style.min_grouped {
        return int.to_owned();
    }
    let mut out = String::new();
    for (index, digit) in int.chars().enumerate() {
        if index > 0 && (int.len() - index).is_multiple_of(3) {
            out.push(style.group);
        }
        out.push(digit);
    }
    out
}
fn number_in(code: &str, value: f64, min: usize, max: usize) -> (bool, String) {
    let style = number_style(code);
    let (negative, int, frac) = decimal_digits(value, min, max);
    let mut text = grouped(&int, &style);
    if !frac.is_empty() {
        text.push(style.decimal);
        text.push_str(&frac);
    }
    (negative, text)
}
/// `formatNumber(value, {maximumFractionDigits})` in `code`.
pub fn format_decimal_in(code: &str, value: f64, max_fraction: usize) -> String {
    let (negative, text) = number_in(code, value, 0, max_fraction);
    if negative { format!("-{text}") } else { text }
}
/// `formatNumber(value, {style: "percent", maximumFractionDigits: 0})` in
/// `code`: Spanish, French and German set the sign apart with a no-break
/// space.
pub fn format_percent_in(code: &str, value: f64) -> String {
    let (negative, text) = number_in(code, value * 100., 0, 0);
    let sign = if matches!(code, "es" | "fr" | "de") {
        "\u{a0}%"
    } else {
        "%"
    };
    format!("{}{text}{sign}", if negative { "-" } else { "" })
}
/// `format_percent_in` in the current locale.
pub fn format_percent(value: f64) -> String {
    let code = CURRENT.with(|c| c.borrow().clone());
    format_percent_in(&code, value)
}
/// `formatNumber(value)` (`Intl.NumberFormat`) for an integer in the current
/// locale.
pub fn format_number(value: i64) -> String {
    format_decimal_in(&current_code(), value as f64, 0)
}
/// `formatNumber(value, {maximumFractionDigits})` in the current locale.
pub fn format_decimal(value: f64, max_fraction: usize) -> String {
    format_decimal_in(&current_code(), value, max_fraction)
}
/// `formatNumber(amount, {style: "currency", currencyDisplay: "narrowSymbol",
/// maximumFractionDigits: fraction})` in `code`; the currency's minor digits
/// are shown when `fraction` is 2.
pub fn format_currency_in(code: &str, amount: f64, currency: &str, fraction: usize) -> String {
    let (negative, number) = number_in(code, amount, fraction, fraction);
    let symbol = match currency.to_ascii_uppercase().as_str() {
        "USD" => "$".to_owned(),
        "EUR" => "€".to_owned(),
        "GBP" => "£".to_owned(),
        other => other.to_owned(),
    };
    let sign = if negative { "-" } else { "" };
    match number_style(code).currency {
        CurrencyPosition::Before => format!("{sign}{symbol}{number}"),
        CurrencyPosition::BeforeSpaced => format!("{sign}{symbol}\u{a0}{number}"),
        CurrencyPosition::After => format!("{sign}{number}\u{a0}{symbol}"),
    }
}
/// `format_currency_in` in the current locale.
pub fn format_currency(amount: f64, currency: &str, fraction: usize) -> String {
    format_currency_in(&current_code(), amount, currency, fraction)
}

/// Parameter-free message in the current locale.
pub fn t(key: &str) -> &'static str {
    current().text(key)
}
/// Formatted message in the current locale.
pub fn tf(key: &str, args: &[(&str, Arg)]) -> String {
    current().format(key, args)
}

#[derive(Clone, Debug)]
pub enum Arg {
    Text(String),
    Number(i64),
}
impl From<&str> for Arg {
    fn from(value: &str) -> Self {
        Self::Text(value.into())
    }
}
impl From<String> for Arg {
    fn from(value: String) -> Self {
        Self::Text(value)
    }
}
impl From<usize> for Arg {
    fn from(value: usize) -> Self {
        Self::Number(value as i64)
    }
}
impl From<i64> for Arg {
    fn from(value: i64) -> Self {
        Self::Number(value)
    }
}
impl From<u32> for Arg {
    fn from(value: u32) -> Self {
        Self::Number(value as i64)
    }
}

#[derive(Clone)]
pub struct Locale {
    pub code: String,
}
impl Default for Locale {
    fn default() -> Self {
        current()
    }
}
impl Locale {
    pub fn choices() -> impl Iterator<Item = (&'static str, &'static str)> {
        ready(data())
    }
    pub fn set(&mut self, code: &str) -> bool {
        if Self::choices().any(|(id, _)| id == code) && self.code != code {
            self.code = code.into();
            true
        } else {
            false
        }
    }
    pub fn text(&self, key: &str) -> &'static str {
        data()["catalogs"][&self.code][key]
            .as_str()
            .or_else(|| data()["catalogs"]["en"][key].as_str())
            .or_else(|| native()["catalogs"][&self.code][key].as_str())
            .or_else(|| native()["catalogs"]["en"][key].as_str())
            .unwrap_or_else(|| intern(key))
    }
    pub fn format(&self, key: &str, args: &[(&str, Arg)]) -> String {
        format_message(self.text(key), args, &self.code)
    }
}

/// Missing keys are a projection defect; show the key rather than invent copy.
/// Interned once so repeated renders do not allocate.
fn intern(key: &str) -> &'static str {
    static KEYS: OnceLock<std::sync::Mutex<std::collections::HashSet<&'static str>>> =
        OnceLock::new();
    let mut keys = KEYS.get_or_init(Default::default).lock().unwrap();
    if let Some(found) = keys.get(key) {
        return found;
    }
    let leaked: &'static str = Box::leak(key.to_owned().into_boxed_str());
    keys.insert(leaked);
    leaked
}

fn plural_category(code: &str, n: i64) -> &'static str {
    match code {
        "ja" | "ko" | "zh-Hans" | "zh-Hant" => "other",
        "fr" | "pt-BR" => {
            if n == 0 || n == 1 {
                "one"
            } else {
                "other"
            }
        }
        _ => {
            if n == 1 {
                "one"
            } else {
                "other"
            }
        }
    }
}

/// Render one ICU message. Unknown arguments render as their name so a
/// projection mismatch stays visible.
pub fn format_message(pattern: &str, args: &[(&str, Arg)], code: &str) -> String {
    render(pattern, args, code, None)
}
fn arg<'a>(args: &'a [(&str, Arg)], name: &str) -> Option<&'a Arg> {
    args.iter().find(|(k, _)| *k == name).map(|(_, v)| v)
}
fn render(pattern: &str, args: &[(&str, Arg)], code: &str, hash: Option<i64>) -> String {
    let chars: Vec<char> = pattern.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    while i < chars.len() {
        match chars[i] {
            '{' => {
                let end = matching(&chars, i);
                let body: String = chars[i + 1..end].iter().collect();
                out.push_str(&placeholder(&body, args, code));
                i = end + 1;
            }
            '#' if hash.is_some() => {
                out.push_str(&hash.unwrap().to_string());
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    out
}
fn matching(chars: &[char], open: usize) -> usize {
    let mut depth = 0;
    for (j, c) in chars.iter().enumerate().skip(open) {
        match c {
            '{' => depth += 1,
            '}' => {
                depth -= 1;
                if depth == 0 {
                    return j;
                }
            }
            _ => {}
        }
    }
    chars.len() - 1
}
fn placeholder(body: &str, args: &[(&str, Arg)], code: &str) -> String {
    let mut parts = body.splitn(3, ',');
    let name = parts.next().unwrap_or_default().trim();
    let kind = parts.next().map(str::trim);
    let value = arg(args, name);
    match (kind, value) {
        (None, Some(Arg::Text(text))) => text.clone(),
        (None | Some("number"), Some(Arg::Number(n))) => n.to_string(),
        (Some("plural"), Some(Arg::Number(n))) => {
            let options = parts.next().unwrap_or_default();
            let branches = branches(options);
            let exact = format!("={n}");
            let category = plural_category(code, *n);
            branches
                .iter()
                .find(|(k, _)| *k == exact)
                .or_else(|| branches.iter().find(|(k, _)| *k == category))
                .or_else(|| branches.iter().find(|(k, _)| *k == "other"))
                .map(|(_, v)| render(v, args, code, Some(*n)))
                .unwrap_or_default()
        }
        // `{gender, select, female {…} other {…}}`: the exact key, else other.
        (Some("select"), Some(value)) => {
            let key = match value {
                Arg::Text(text) => text.clone(),
                Arg::Number(n) => n.to_string(),
            };
            let branches = branches(parts.next().unwrap_or_default());
            branches
                .iter()
                .find(|(k, _)| *k == key)
                .or_else(|| branches.iter().find(|(k, _)| *k == "other"))
                .map(|(_, v)| render(v, args, code, None))
                .unwrap_or_default()
        }
        (_, Some(Arg::Text(text))) => text.clone(),
        _ => format!("{{{name}}}"),
    }
}
fn branches(options: &str) -> Vec<(String, String)> {
    let chars: Vec<char> = options.chars().collect();
    let mut result = vec![];
    let mut i = 0;
    while i < chars.len() {
        while i < chars.len() && chars[i].is_whitespace() {
            i += 1;
        }
        let start = i;
        while i < chars.len() && chars[i] != '{' && !chars[i].is_whitespace() {
            i += 1;
        }
        let key: String = chars[start..i].iter().collect();
        while i < chars.len() && chars[i] != '{' {
            i += 1;
        }
        if i >= chars.len() {
            break;
        }
        let end = matching(&chars, i);
        result.push((key, chars[i + 1..end].iter().collect()));
        i = end + 1;
    }
    result
}

/// A unit of [`relative_past`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TimeUnit {
    Minute,
    Hour,
    Day,
}
/// `Intl.RelativeTimeFormat(locale, { numeric: "always" }).format(-n, unit)`
/// in the current locale: "2 minutes ago", "2分钟前", "vor 2 Minuten".
pub fn relative_past(n: i64, unit: TimeUnit) -> String {
    let code = CURRENT.with(|c| c.borrow().clone());
    relative_past_in(&code, n, unit)
}
fn relative_past_in(code: &str, n: i64, unit: TimeUnit) -> String {
    use TimeUnit::*;
    let one = plural_category(code, n) == "one";
    let pick = |singular: &'static str, plural: &'static str| if one { singular } else { plural };
    match code {
        "zh-Hans" => format!(
            "{n}{}前",
            match unit {
                Minute => "分钟",
                Hour => "小时",
                Day => "天",
            }
        ),
        "ja" => format!(
            "{n} {}前",
            match unit {
                Minute => "分",
                Hour => "時間",
                Day => "日",
            }
        ),
        "ko" => format!(
            "{n}{} 전",
            match unit {
                Minute => "분",
                Hour => "시간",
                Day => "일",
            }
        ),
        "de" => format!(
            "vor {n} {}",
            match unit {
                Minute => pick("Minute", "Minuten"),
                Hour => pick("Stunde", "Stunden"),
                Day => pick("Tag", "Tagen"),
            }
        ),
        "fr" => format!(
            "il y a {n} {}",
            match unit {
                Minute => pick("minute", "minutes"),
                Hour => pick("heure", "heures"),
                Day => pick("jour", "jours"),
            }
        ),
        "es" => format!(
            "hace {n} {}",
            match unit {
                Minute => pick("minuto", "minutos"),
                Hour => pick("hora", "horas"),
                Day => pick("día", "días"),
            }
        ),
        "pt-BR" => format!(
            "há {n} {}",
            match unit {
                Minute => pick("minuto", "minutos"),
                Hour => pick("hora", "horas"),
                Day => pick("dia", "dias"),
            }
        ),
        _ => format!(
            "{n} {} ago",
            match unit {
                Minute => pick("minute", "minutes"),
                Hour => pick("hour", "hours"),
                Day => pick("day", "days"),
            }
        ),
    }
}

/// `Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(0, "second")`.
pub fn relative_now() -> &'static str {
    let code = CURRENT.with(|c| c.borrow().clone());
    match code.as_str() {
        "zh-Hans" => "现在",
        "ja" => "今",
        "ko" => "지금",
        "de" => "jetzt",
        "fr" => "maintenant",
        "es" => "ahora",
        "pt-BR" => "agora",
        _ => "now",
    }
}
/// `Intl.ListFormat(locale, { type: "conjunction" })` ("3 files and 2
/// searches", "A, B, and C", "A、B和C").
pub fn and_list(items: &[String]) -> String {
    let code = CURRENT.with(|c| c.borrow().clone());
    and_list_in(&code, items)
}
fn and_list_in(code: &str, items: &[String]) -> String {
    // CLDR's standard list patterns: the separator between the items, the
    // one before the last of three or more, and the one between two.
    let (between, last, pair) = match code {
        "zh-Hans" => ("、", "和", "和"),
        "ja" => ("、", "、", "、"),
        "ko" => (", ", " 및 ", " 및 "),
        "de" => (", ", " und ", " und "),
        "fr" => (", ", " et ", " et "),
        "es" => (", ", " y ", " y "),
        "pt-BR" => (", ", " e ", " e "),
        _ => (", ", ", and ", " and "),
    };
    match items {
        [] => String::new(),
        [one] => one.clone(),
        [a, b] => format!("{a}{pair}{b}"),
        [rest @ .., end] => format!("{}{last}{end}", rest.join(between)),
    }
}
/// `Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(n, "day")`
/// for today (0) and yesterday (-1).
pub fn relative_day(offset: i64) -> String {
    let code = CURRENT.with(|c| c.borrow().clone());
    relative_day_in(&code, offset).to_owned()
}
fn relative_day_in(code: &str, offset: i64) -> &'static str {
    let (today, yesterday) = match code {
        "zh-Hans" => ("今天", "昨天"),
        "ja" => ("今日", "昨日"),
        "ko" => ("오늘", "어제"),
        "de" => ("heute", "gestern"),
        "fr" => ("aujourd’hui", "hier"),
        "es" => ("hoy", "ayer"),
        "pt-BR" => ("hoje", "ontem"),
        _ => ("today", "yesterday"),
    };
    if offset == 0 { today } else { yesterday }
}
/// `Intl.DateTimeFormat(locale, { month: "short", day: "numeric", year })`:
/// "Oct 23", "10月23日", "23. Okt."; the year only when given.
pub fn month_day(year: Option<i32>, month: u32, day: u32) -> String {
    let code = CURRENT.with(|c| c.borrow().clone());
    month_day_in(&code, year, month, day)
}
fn month_day_in(code: &str, year: Option<i32>, month: u32, day: u32) -> String {
    let short = |names: [&'static str; 12]| names[(month.clamp(1, 12) - 1) as usize];
    match (code, year) {
        ("zh-Hans" | "ja", None) => format!("{month}月{day}日"),
        ("zh-Hans" | "ja", Some(y)) => format!("{y}年{month}月{day}日"),
        ("ko", None) => format!("{month}월 {day}일"),
        ("ko", Some(y)) => format!("{y}년 {month}월 {day}일"),
        ("de", _) => {
            let m = short([
                "Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sept.", "Okt.",
                "Nov.", "Dez.",
            ]);
            year.map_or(format!("{day}. {m}"), |y| format!("{day}. {m} {y}"))
        }
        ("fr", _) => {
            let m = short([
                "janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.",
                "nov.", "déc.",
            ]);
            year.map_or(format!("{day} {m}"), |y| format!("{day} {m} {y}"))
        }
        ("es", _) => {
            let m = short([
                "ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic",
            ]);
            year.map_or(format!("{day} {m}"), |y| format!("{day} {m} {y}"))
        }
        ("pt-BR", _) => {
            let m = short([
                "jan.", "fev.", "mar.", "abr.", "mai.", "jun.", "jul.", "ago.", "set.", "out.",
                "nov.", "dez.",
            ]);
            year.map_or(format!("{day} de {m}"), |y| format!("{day} de {m} de {y}"))
        }
        _ => {
            let m = short([
                "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
            ]);
            year.map_or(format!("{m} {day}"), |y| format!("{m} {day}, {y}"))
        }
    }
}

#[cfg(test)]
mod tests {
    /// `fixtures/ui/number-format-oracle.json`: Intl itself, in every
    /// product language.
    #[test]
    fn numbers_and_money_read_as_intl_writes_them() {
        let oracle: serde_json::Value =
            serde_json::from_str(include_str!("../fixtures/ui/number-format-oracle.json")).unwrap();
        let mut wrong = Vec::new();
        for case in oracle["cases"].as_array().unwrap() {
            let locale = case["locale"].as_str().unwrap();
            let value = case["value"].as_f64().unwrap();
            let actual = if case["kind"] == "percent" {
                super::format_percent_in(locale, value)
            } else if case["kind"] == "currency" {
                super::format_currency_in(
                    locale,
                    value,
                    case["currency"].as_str().unwrap(),
                    case["fraction"].as_u64().unwrap() as usize,
                )
            } else {
                super::format_decimal_in(locale, value, case["max"].as_u64().unwrap() as usize)
            };
            if actual != case["expected"].as_str().unwrap() {
                wrong.push(format!("{case} -> {actual:?}"));
            }
        }
        assert!(wrong.is_empty(), "{}", wrong.join("\n"));
    }
    #[test]
    fn days_and_dates_follow_intl() {
        use super::{month_day_in, relative_day_in};
        assert_eq!(relative_day_in("en", -1), "yesterday");
        assert_eq!(relative_day_in("zh-Hans", 0), "今天");
        assert_eq!(month_day_in("en", None, 10, 23), "Oct 23");
        assert_eq!(month_day_in("en", Some(2025), 1, 5), "Jan 5, 2025");
        assert_eq!(month_day_in("zh-Hans", None, 10, 23), "10月23日");
        assert_eq!(month_day_in("de", None, 3, 2), "2. März");
        assert_eq!(
            month_day_in("pt-BR", Some(2024), 10, 23),
            "23 de out. de 2024"
        );
    }
    /// `formatList`: Intl's conjunction, however many there are.
    #[test]
    fn lists_join_as_intl_list_format_does() {
        let names = |n: usize| {
            ["A", "B", "C", "D"][..n]
                .iter()
                .map(|s| s.to_string())
                .collect::<Vec<_>>()
        };
        assert_eq!(super::and_list_in("en", &names(0)), "");
        assert_eq!(super::and_list_in("en", &names(1)), "A");
        assert_eq!(super::and_list_in("en", &names(2)), "A and B");
        assert_eq!(super::and_list_in("en", &names(4)), "A, B, C, and D");
        assert_eq!(super::and_list_in("zh-Hans", &names(2)), "A和B");
        assert_eq!(super::and_list_in("zh-Hans", &names(3)), "A、B和C");
        assert_eq!(super::and_list_in("ja", &names(3)), "A、B、C");
        assert_eq!(super::and_list_in("ko", &names(3)), "A, B 및 C");
        assert_eq!(super::and_list_in("de", &names(3)), "A, B und C");
        assert_eq!(super::and_list_in("fr", &names(3)), "A, B et C");
        assert_eq!(super::and_list_in("es", &names(2)), "A y B");
        assert_eq!(super::and_list_in("pt-BR", &names(3)), "A, B e C");
    }
    #[test]
    fn relative_past_follows_intl_relative_time_format() {
        use super::{TimeUnit::*, relative_past_in};
        assert_eq!(relative_past_in("en", 1, Day), "1 day ago");
        assert_eq!(relative_past_in("en", 2, Minute), "2 minutes ago");
        assert_eq!(relative_past_in("zh-Hans", 3, Hour), "3小时前");
        assert_eq!(relative_past_in("de", 1, Day), "vor 1 Tag");
        assert_eq!(relative_past_in("fr", 1, Minute), "il y a 1 minute");
        assert_eq!(relative_past_in("ja", 5, Day), "5 日前");
    }
    use super::*;

    /// `settingsVisualArchitecture`: every product locale carries the core
    /// Settings, Typography, Privacy, Local Agents, Agent file activity,
    /// Language and Local Project copy, and none the retired sidebar entries.
    #[test]
    fn core_settings_copy_is_complete_in_every_product_locale() {
        let mut present: Vec<String> = [
            "sidebar.localProject",
            "sidebar.privacy",
            "sidebar.projectInfo",
            "sidebar.localAgents",
            "sidebar.agents",
            "sidebar.createNew",
            "sidebar.typography",
            "general.title",
            "general.detail",
            "localAgents.title",
            "localAgents.detail",
            "localAgents.activeChat.title",
            "localAgents.toggle",
            "localAgents.history.title",
            "localAgents.history.detail",
            "localAgents.history.toggle",
            "localAgentHooks.title",
            "localAgentHooks.manage",
            "localAgentHooks.choose",
            "localAgentHooks.status.installed",
            "appearance.agentFileActivity.title",
        ]
        .map(String::from)
        .into();
        let groups: [(&str, &[&str]); 5] = [
            (
                "typography",
                &[
                    "title",
                    "detail",
                    "textSize.title",
                    "textSize.ariaLabel",
                    "textSize.scale.small",
                    "textSize.scale.medium",
                    "textSize.scale.large",
                    "textSize.useScale",
                    "preview.ariaLabel",
                    "preview.leftSidebar",
                    "preview.editor",
                    "preview.rightSidebar",
                    "preview.chat",
                    "preview.message",
                ],
            ),
            (
                "privacy",
                &[
                    "title",
                    "detail",
                    "productAnalyze.title",
                    "productAnalyze.detail",
                    "productAnalyze.error",
                    "productAnalyze.learnMore",
                ],
            ),
            (
                "appearance.agentFileActivity.permission",
                &[
                    "title",
                    "detail",
                    "accessTitle",
                    "accessDetail",
                    "localOnly",
                    "enable",
                    "enabling",
                    "error",
                ],
            ),
            (
                "language",
                &["selectorLabel", "system", "changing", "changeFailed"],
            ),
            (
                "localProject",
                &[
                    "title",
                    "detail",
                    "name",
                    "path",
                    "mode",
                    "modeLocal",
                    "status",
                    "protected",
                    "recentWorkspace",
                    "unlink.title",
                    "unlink.action",
                    "unlink.progress",
                    "unlink.confirm",
                ],
            ),
        ];
        for (group, keys) in groups {
            present.extend(keys.iter().map(|key| format!("{group}.{key}")));
        }
        let retired = [
            "sidebar.language",
            "sidebar.editor",
            "sidebar.defaultApps",
            "sidebar.localAgentHooks",
        ];
        let catalogs = data()["catalogs"].as_object().unwrap();
        assert_eq!(catalogs.len(), 8);
        for (locale, catalog) in catalogs {
            for key in &present {
                assert!(
                    catalog[format!("settings.{key}")]
                        .as_str()
                        .is_some_and(|text| !text.is_empty()),
                    "{locale}: settings.{key}"
                );
            }
            for key in retired {
                assert!(
                    catalog[format!("settings.{key}")].is_null(),
                    "{locale}: settings.{key}"
                );
            }
        }
    }
    /// `DesktopLocaleService`: the system's first supported language is
    /// chosen (regional tags fall back to their language), the OS is
    /// followed only while the preference is System, an unsupported
    /// preference is not kept, and a locale whose release flag is off is
    /// neither offered nor resolved for the system.
    #[test]
    fn the_system_language_is_followed_only_while_the_preference_is_system() {
        let langs = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(resolve_system(&langs(&["fr-CA", "en-US"])), "fr");
        assert_eq!(
            resolve_preference("system", &langs(&["zh-TW", "es-MX"])),
            "es"
        );
        assert_eq!(resolve_preference("system", &langs(&["ja-JP"])), "ja");
        assert_eq!(resolve_preference("ko", &langs(&["fr-FR"])), "ko");
        assert_eq!(resolve_preference("it", &langs(&["de-DE"])), "de");
        let fr = Locale { code: "fr".into() };
        assert_eq!(fr.text("native.dock.newWindow"), "Nouvelle fenêtre");
        assert_eq!(fr.text("native.menu.file"), "Fichier");
        let mut manifest = data().clone();
        for entry in manifest["locales"].as_array_mut().unwrap() {
            if entry["locale"] == "es" {
                entry["productionReady"] = false.into();
            }
        }
        let choices: Vec<&str> = ready(&manifest).map(|(id, _)| id).collect();
        assert!(!choices.contains(&"es") && choices.contains(&"fr"));
        assert_eq!(resolve_among(&choices, &langs(&["es-MX", "en-US"])), "en");
    }
    #[test]
    fn languages_come_from_product_and_invalid_updates_keep_previous_state() {
        let mut locale = Locale { code: "en".into() };
        assert_eq!(Locale::choices().count(), 8);
        assert!(locale.set("zh-Hans"));
        assert_eq!(locale.text("settings.general.title"), "通用");
        assert!(!locale.set("unknown"));
        assert_eq!(locale.code, "zh-Hans");
        assert!(!locale.set("zh-Hans"));
    }
    #[test]
    fn icu_subset_matches_product_catalog_usage() {
        let en = Locale { code: "en".into() };
        assert_eq!(
            en.format("agent.header.newSession", &[("agent", "Codex".into())]),
            "New Codex session"
        );
        assert_eq!(
            en.format("workspace.node.deleteItems", &[("count", 1usize.into())]),
            "Delete item"
        );
        assert_eq!(
            en.format("workspace.node.deleteItems", &[("count", 3usize.into())]),
            "Delete 3 items"
        );
        assert_eq!(
            en.format("agent.reference.batchResult", &[("count", 0usize.into())]),
            "Added no references."
        );
        let zh = Locale {
            code: "zh-Hans".into(),
        };
        assert!(
            zh.format("workspace.node.deleteItems", &[("count", 1usize.into())])
                .contains('1')
        );
        assert_eq!(format_message("{x}", &[], "en"), "{x}");
        // `select`: the matching branch, else `other`; nested arguments render.
        let select = "{kind, select, folder {Folder {name}} file {File} other {Item}}";
        let kind =
            |k: &str| format_message(select, &[("kind", k.into()), ("name", "docs".into())], "en");
        assert_eq!(kind("folder"), "Folder docs");
        assert_eq!(kind("file"), "File");
        assert_eq!(kind("link"), "Item");
        let langs = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(resolve_system(&langs(&["zh-Hans-CN", "en"])), "zh-Hans");
        assert_eq!(resolve_system(&langs(&["pt-PT"])), "pt-BR");
        assert_eq!(resolve_system(&langs(&["de-AT"])), "de");
        assert_eq!(resolve_system(&langs(&["xx"])), "en");
        assert_eq!(resolve_preference("ja", &[]), "ja");
        // Every native-only message exists in every production locale.
        let en = native()["catalogs"]["en"].as_object().unwrap();
        for (code, _) in Locale::choices() {
            let catalog = native()["catalogs"][code].as_object().unwrap();
            for key in en.keys() {
                assert!(catalog.contains_key(key), "{code} lacks {key}");
            }
        }
    }
    #[test]
    fn workers_inherit_the_spawning_locale() {
        // Runs on its own thread so the per-thread locale does not leak.
        std::thread::spawn(|| {
            set_current("zh-Hans");
            let (tx, rx) = std::sync::mpsc::channel();
            spawn(move || {
                let _ = tx.send(t("native.workspace.nameExists"));
            })
            .join()
            .unwrap();
            assert_eq!(rx.recv().unwrap(), "已存在同名项目。");
            let plain = std::thread::spawn(|| t("native.workspace.nameExists"));
            assert_ne!(plain.join().unwrap(), "已存在同名项目。");
        })
        .join()
        .unwrap();
    }
    /// Every message the native code names literally exists somewhere: in a
    /// product catalog, the asset projection, or the native catalog. A key
    /// the product dropped shows as itself, so it fails here instead.
    #[test]
    fn every_literal_message_key_resolves() {
        let pattern = regex::Regex::new(
            r#"\b(?:t|tr|tf)\(\s*"([A-Za-z][A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]+)+)""#,
        )
        .unwrap();
        let known = |key: &str| {
            data()["catalogs"]["en"][key].is_string() || native()["catalogs"]["en"][key].is_string()
        };
        let mut missing = Vec::new();
        let mut dirs = vec![std::path::PathBuf::from(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../src"
        ))];
        while let Some(dir) = dirs.pop() {
            for entry in std::fs::read_dir(&dir).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    dirs.push(path);
                } else if path.extension().is_some_and(|e| e == "rs") {
                    let source = std::fs::read_to_string(&path).unwrap();
                    for found in pattern.captures_iter(&source) {
                        let key = &found[1];
                        if !known(key) {
                            missing.push(format!("{}: {key}", path.display()));
                        }
                    }
                }
            }
        }
        missing.sort();
        assert!(
            missing.is_empty(),
            "unknown message keys:\n{}",
            missing.join("\n")
        );
    }
    #[test]
    fn sign_in_explainer_messages_resolve_in_every_product_locale() {
        let keys = [
            "cloud.auth.explainer.dots",
            "cloud.auth.explainer.cloud.label",
            "cloud.auth.explainer.cloud.title",
            "cloud.auth.explainer.cloud.body",
            "cloud.auth.explainer.share.label",
            "cloud.auth.explainer.share.title",
            "cloud.auth.explainer.share.body",
            "cloud.auth.explainer.submit",
            "cloud.auth.explainer.later",
            "onboarding.value.folder",
            "onboarding.value.scene.dashboard",
            "onboarding.value.scene.changedBy",
        ];
        for (code, _) in Locale::choices() {
            let locale = Locale { code: code.into() };
            for key in keys {
                let value = locale.text(key);
                assert_ne!(value, key, "{code} lacks {key}");
                assert!(!value.trim().is_empty(), "{code} has empty {key}");
            }
        }
    }
    #[test]
    fn onboarding_home_messages_resolve_in_every_product_locale() {
        let keys = [
            "onboarding.agents.cloud",
            "onboarding.agents.connect",
            "onboarding.agents.connected",
            "onboarding.agents.lastActive",
            "onboarding.agents.start",
            "onboarding.agentStart.promptLabel",
            "onboarding.agentStart.promptPlaceholder",
            "onboarding.agentStart.note",
            "onboarding.agentStart.submit",
            "onboarding.sharing.thisMac",
        ];
        for (code, _) in Locale::choices() {
            let locale = Locale { code: code.into() };
            for key in keys {
                let value = locale.text(key);
                assert_ne!(value, key, "{code} lacks {key}");
                assert!(!value.trim().is_empty(), "{code} has empty {key}");
            }
        }
    }
    #[test]
    fn cloud_computer_screen_messages_resolve_in_every_product_locale() {
        let keys = [
            "cloud.sandbox.screen.label",
            "cloud.sandbox.screen.open",
            "cloud.sandbox.screen.preview-note",
            "cloud.sandbox.screen.not-installed",
            "cloud.sandbox.screen.install",
            "cloud.sandbox.screen.install-pending",
            "cloud.sandbox.screen.stream-off",
            "cloud.sandbox.screen.stream-on",
            "cloud.sandbox.screen.unavailable",
            "cloud.sandbox.screen.asleep",
            "cloud.sandbox.screen.wake",
            "cloud.sandbox.screen.connecting",
            "cloud.sandbox.screen.disconnected",
            "cloud.sandbox.screen.retry",
            "cloud.settings.tab.computer",
            "cloud.settings.computer.title",
            "cloud.settings.computer.detail",
            "cloud.settings.computer.desktop",
            "cloud.settings.computer.desktopHelp",
            "cloud.settings.computer.desktopPending",
            "cloud.settings.computer.stream",
            "cloud.settings.computer.streamHelp",
            "cloud.settings.computer.failed",
            "settings.experimental.cloudComputerScreen.title",
            "settings.experimental.cloudComputerScreen.detail",
            "settings.experimental.isolatedAgentSandboxes.title",
            "settings.experimental.isolatedAgentSandboxes.detail",
            "cloud.settings.computer.isolatedAgents",
            "cloud.settings.computer.isolatedAgentsHelp",
        ];
        for (code, _) in Locale::choices() {
            let locale = Locale { code: code.into() };
            for key in keys {
                let value = locale.text(key);
                assert_ne!(value, key, "{code} lacks {key}");
                assert!(!value.trim().is_empty(), "{code} has empty {key}");
            }
        }
    }
    /// `cloudOpeningFailureClassification`: every message the opening table
    /// names, and the diagnostic copy, exists in every product locale.
    #[test]
    fn cloud_opening_failure_copy_exists_in_every_product_locale() {
        let keys = [
            "message.workspace-start-timeout",
            "message.workspace-preparing",
            "message.workspace-connection-unavailable",
            "message.workspace-open-failed",
            "message.workspace-changed",
            "message.workspace-disk-lost",
            "message.workspace-recovery-required",
            "message.workspace-plan-required",
            "message.workspace-access-denied",
            "message.project-unavailable",
            "message.workspace-not-configured",
            "opening.failedTitle",
            "opening.diagnosticCode",
            "opening.diagnosticRequest",
            "opening.copyDiagnostic",
            "opening.diagnosticCopied",
        ];
        let catalogs = data()["catalogs"].as_object().unwrap();
        assert_eq!(catalogs.len(), 8);
        for (locale, catalog) in catalogs {
            for key in keys {
                assert!(
                    catalog[format!("cloud.{key}")].is_string(),
                    "{locale}: cloud.{key}"
                );
            }
        }
    }
    #[test]
    fn computer_mode_messages_resolve_in_every_product_locale() {
        let keys = [
            "onboarding.computerMode.sectionTitle",
            "onboarding.computerMode.createAction",
            "onboarding.computerMode.thisMacTitle",
            "onboarding.computerMode.thisComputerTitle",
            "onboarding.computerMode.emptyOnDevice",
            "onboarding.computerMode.plainFolders.title",
            "onboarding.computerMode.plainFolders.hint",
            "onboarding.computerMode.status.running",
            "onboarding.computerMode.status.provisioning",
            "onboarding.computerMode.status.asleep",
            "onboarding.computerMode.dialog.title",
            "onboarding.computerMode.dialog.whereLabel",
            "onboarding.computerMode.dialog.cloudTitle",
            "onboarding.computerMode.dialog.cloudDetail",
            "onboarding.computerMode.dialog.cloudUnavailable",
            "onboarding.computerMode.dialog.onDeviceTitle",
            "onboarding.computerMode.dialog.onDeviceDetail",
            "onboarding.computerMode.dialog.runtimeReady",
            "onboarding.computerMode.dialog.runtimeManaged",
            "onboarding.computerMode.dialog.nameLabel",
            "onboarding.computerMode.dialog.defaultName",
            "onboarding.computerMode.dialog.submit",
            "onboarding.computerMode.dialog.submitting",
            "onboarding.computerMode.screen.asleepNote",
            "onboarding.computerMode.screen.wakeAction",
            "onboarding.computerMode.screen.sleepAction",
            "onboarding.computerMode.screen.provisioningNote",
            "onboarding.computerMode.screen.workspaceReadyNote",
            "onboarding.computerMode.screen.startDesktopAction",
            "settings.experimental.computerMode.title",
            "settings.experimental.computerMode.detail",
        ];
        for (code, _) in Locale::choices() {
            let locale = Locale { code: code.into() };
            for key in keys {
                let value = locale.text(key);
                assert_ne!(value, key, "{code} lacks {key}");
                assert!(!value.trim().is_empty(), "{code} has empty {key}");
            }
        }
    }
}
