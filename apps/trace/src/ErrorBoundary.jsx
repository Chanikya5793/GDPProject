import { Component } from "react";

// Keeps one broken step from blanking the whole site.
export default class ErrorBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <h2>This view stopped working.</h2>
        <p>{this.state.error.message}</p>
        <button className="primary" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}
