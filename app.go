package main

import (
	"os/exec"
	"runtime"
	"strings"
	"time"
)

type App struct{}

func NewApp() *App {
	return &App{}
}

type EnvironmentInfo struct {
	Message     string `json:"message"`
	GoVersion   string `json:"goVersion"`
	NodeVersion string `json:"nodeVersion"`
	OS          string `json:"os"`
	Arch        string `json:"arch"`
	Time        string `json:"time"`
}

func (a *App) GetVersionNode() string {
	out, err := exec.Command("node", "--version").Output()
	if err != nil {
		return ""
	}

	return strings.TrimSpace(string(out))
}
func (a *App) CheckEnvironment() EnvironmentInfo {
	return EnvironmentInfo{
		Message:     "Go backend подключён и отвечает",
		GoVersion:   runtime.Version(),
		NodeVersion: a.GetVersionNode(),
		OS:          runtime.GOOS,
		Arch:        runtime.GOARCH,
		Time:        time.Now().Format("15:04:05 02.01.2006"),
	}
}
