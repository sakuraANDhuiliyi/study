package cn.huiliyi.verification;
import com.android.uiautomator.core.Configurator;
import com.android.uiautomator.testrunner.UiAutomatorTestCase;
public final class HierarchyDump extends UiAutomatorTestCase {
  public void testDump() throws Exception {
    Configurator.getInstance().setWaitForIdleTimeout(0L);
    Configurator.getInstance().setWaitForSelectorTimeout(0L);
    for (int attempt = 0; attempt < 10; attempt++) {
      Thread.sleep(100L);
      getUiDevice().dumpWindowHierarchy("zhixue-review.xml");
      if (new java.io.File("/data/local/tmp/zhixue-review.xml").isFile()) break;
    }
    if (!new java.io.File("/data/local/tmp/zhixue-review.xml").isFile()) {
      System.out.println("NO_ACTIVE_WINDOW");
    }
  }
}
