import { t } from "@excalidraw/excalidraw/i18n";
import * as Sentry from "@sentry/browser";
import React from "react";

interface TopErrorBoundaryState {
  hasError: boolean;
  sentryEventId: string;
  localStorage: string;
}

export class TopErrorBoundary extends React.Component<
  any,
  TopErrorBoundaryState
> {
  private renderTranslatedAction(
    translation: string,
    action: (label: string) => React.ReactNode,
  ) {
    const match = translation.match(/^(.*)<button>(.*)<\/button>(.*)$/);

    if (!match) {
      return translation;
    }

    const [, before, label, after] = match;
    return (
      <>
        {before}
        {action(label)}
        {after}
      </>
    );
  }

  state: TopErrorBoundaryState = {
    hasError: false,
    sentryEventId: "",
    localStorage: "",
  };

  render() {
    return this.state.hasError ? this.errorSplash() : this.props.children;
  }

  componentDidCatch(error: Error, errorInfo: any) {
    const _localStorage: any = {};
    for (const [key, value] of Object.entries({ ...localStorage })) {
      try {
        _localStorage[key] = JSON.parse(value);
      } catch (error: any) {
        _localStorage[key] = value;
      }
    }

    Sentry.withScope((scope) => {
      scope.setExtras(errorInfo);
      const eventId = Sentry.captureException(error);

      this.setState((state) => ({
        hasError: true,
        sentryEventId: eventId,
        localStorage: JSON.stringify(_localStorage),
      }));
    });
  }

  private selectTextArea(event: React.MouseEvent<HTMLTextAreaElement>) {
    if (event.target !== document.activeElement) {
      event.preventDefault();
      (event.target as HTMLTextAreaElement).select();
    }
  }

  private async createGithubIssue() {
    let body = "";
    try {
      const templateStrFn = (
        await import(
          /* webpackChunkName: "bug-issue-template" */ "../bug-issue-template"
        )
      ).default;
      body = encodeURIComponent(templateStrFn(this.state.sentryEventId));
    } catch (error: any) {
      console.error(error);
    }

    window.open(
      `https://github.com/excalidraw/excalidraw/issues/new?body=${body}`,
      "_blank",
      "noopener noreferrer",
    );
  }

  private errorSplash() {
    return (
      <div className="ErrorSplash excalidraw">
        <div className="ErrorSplash-messageContainer">
          <div className="ErrorSplash-paragraph bigger align-center">
            {this.renderTranslatedAction(
              t("errorSplash.headingMain"),
              (label) => (
                <button onClick={() => window.location.reload()}>
                  {label}
                </button>
              ),
            )}
          </div>
          <div className="ErrorSplash-paragraph align-center">
            {this.renderTranslatedAction(
              t("errorSplash.clearCanvasMessage"),
              (label) => (
                <button
                  onClick={() => {
                    try {
                      localStorage.clear();
                      window.location.reload();
                    } catch (error: any) {
                      console.error(error);
                    }
                  }}
                >
                  {label}
                </button>
              ),
            )}
            <br />
            <div className="smaller">
              <span role="img" aria-label="warning">
                ⚠️
              </span>
              {t("errorSplash.clearCanvasCaveat")}
              <span role="img" aria-hidden="true">
                ⚠️
              </span>
            </div>
          </div>
          <div>
            <div className="ErrorSplash-paragraph">
              {t("errorSplash.trackedToSentry", {
                eventId: this.state.sentryEventId,
              })}
            </div>
            <div className="ErrorSplash-paragraph">
              {this.renderTranslatedAction(
                t("errorSplash.openIssueMessage"),
                (label) => (
                  <button onClick={() => this.createGithubIssue()}>
                    {label}
                  </button>
                ),
              )}
            </div>
            <div className="ErrorSplash-paragraph">
              <div className="ErrorSplash-details">
                <label>{t("errorSplash.sceneContent")}</label>
                <textarea
                  rows={5}
                  onPointerDown={this.selectTextArea}
                  readOnly={true}
                  value={this.state.localStorage}
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
