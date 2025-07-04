import {
  createConnection,
  ProposedFeatures,
  InitializeParams,
  DidChangeConfigurationNotification,
  DidChangeWatchedFilesNotification,
  TextDocumentSyncKind,
  InitializeResult,
  Connection,
} from "vscode-languageserver/node"

import { Service } from "./service"
import { HerbSettings } from "./settings"

export class Server {
  private service!: Service
  private connection: Connection

  constructor() {
    this.connection = createConnection(ProposedFeatures.all)
    this.setupEventHandlers()
  }

  private setupEventHandlers() {
    this.connection.onInitialize(async (params: InitializeParams) => {
      this.service = new Service(this.connection, params)

      await this.service.init()

      const result: InitializeResult = {
        capabilities: {
          textDocumentSync: TextDocumentSyncKind.Incremental,
        },
      }

      if (this.service.settings.hasWorkspaceFolderCapability) {
        result.capabilities.workspace = {
          workspaceFolders: {
            supported: true,
          },
        }
      }

      return result
    })

    this.connection.onInitialized(() => {
      if (this.service.settings.hasConfigurationCapability) {
        // Register for all configuration changes.
        this.connection.client.register(DidChangeConfigurationNotification.type, undefined)
      }

      if (this.service.settings.hasWorkspaceFolderCapability) {
        this.connection.workspace.onDidChangeWorkspaceFolders((_event) => {
          this.connection.console.log("Workspace folder change event received.")
        })
      }

      this.connection.client.register(DidChangeWatchedFilesNotification.type, {
        watchers: [
          { globPattern: `**/**/*.html.erb` },
          { globPattern: `**/**/.herb-lsp/config.json` },
        ],
      })
    })

    this.connection.onDidChangeConfiguration((change) => {
      if (this.service.settings.hasConfigurationCapability) {
        // Reset all cached document settings
        this.service.settings.documentSettings.clear()
      } else {
        this.service.settings.globalSettings = (
          (change.settings.languageServerHerb || this.service.settings.defaultSettings)
        ) as HerbSettings
      }

      this.service.refresh()
    })

    this.connection.onDidOpenTextDocument((params) => {
      const document = this.service.documentService.get(params.textDocument.uri)

      if (document) {
        this.service.diagnostics.refreshDocument(document)
      }
    })

    this.connection.onDidChangeWatchedFiles((params) => {
      params.changes.forEach(async (event) => {
        if (event.uri.endsWith("/.herb-lsp/config.json")) {
          await this.service.refreshConfig()

          this.service.documentService.getAll().forEach((document) => {
            this.service.diagnostics.refreshDocument(document)
          })
        }
      })
    })
  }

  listen() {
    this.connection.listen()
  }
}
