// Strings shown by the main process (native dialogs). The renderer saves the chosen language in
// settings.json ("language"), see src/renderer/src/i18n/index.js.
const messages = {
  pt: {
    invalidStreamUrlTitle: 'URL de stream inválida',
    invalidStreamUrlBody: 'A URL de stream informada é inválida. Verifique a URL e tente novamente.',
    externalPlayerError:
      'Erro ao iniciar o player externo. Verifique se o caminho do .exe está correto. Você pode definir o caminho correto nas configurações',
    selectDownloadsFolder: 'Selecionar pasta de downloads'
  },
  en: {
    invalidStreamUrlTitle: 'Invalid stream URL',
    invalidStreamUrlBody: 'The stream URL is invalid. Check the URL and try again.',
    externalPlayerError:
      'Error starting the external player. Check that the path to the .exe is correct. You can set the correct path in the settings',
    selectDownloadsFolder: 'Select downloads folder'
  }
}

export function mainT(language, key) {
  return (messages[language === 'en' ? 'en' : 'pt'] || messages.pt)[key]
}
