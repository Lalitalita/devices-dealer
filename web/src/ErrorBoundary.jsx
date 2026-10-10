import { Component } from 'react';

/** Évite l'écran blanc : une erreur dans une page n'emporte plus toute l'application. */
export default class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidUpdate(prev) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="state error" style={{ flexDirection: 'column' }}>
        <b>Une erreur d’affichage est survenue</b>
        <code>{String(this.state.error.message || this.state.error)}</code>
        <button onClick={() => this.setState({ error: null })}>Réessayer</button>
      </div>
    );
  }
}
