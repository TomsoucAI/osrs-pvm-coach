package com.soucyai.dpsbridge;

import net.runelite.client.RuneLite;
import net.runelite.client.externalplugins.ExternalPluginManager;

public class DpsBridgePluginTest
{
	public static void main(String[] args) throws Exception
	{
		ExternalPluginManager.loadBuiltin(DpsBridgePlugin.class);
		RuneLite.main(args);
	}
}
